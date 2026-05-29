const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Let's import the helper functions or define them locally to avoid ES modules errors
function canonicalizeCardNumber(card) {
  const val = String(card ?? "").trim().toUpperCase();
  return val.replace(/^WAB20250*([1-9][0-9]*|0)/, 'WAB2025$1');
}

function buildFamilyNumberingBaseFromCanonical(canonical) {
  const normalized = String(canonical ?? "").trim().toUpperCase();
  const suffixMatch = normalized.match(/^(WAB2025\d+)(?:[WMFH]\d*|[DSB]\d+)$/i);
  return suffixMatch ? suffixMatch[1] : normalized;
}

function parseFamilySuffixFromCanonical(canonical) {
  const val = String(canonical ?? "").trim().toUpperCase();
  const match = val.match(/^WAB2025(\d+)(?:([WMFH])(\d*)|([DSB])(\d+))$/i);
  if (!match) {
    const baseMatch = val.match(/^WAB2025(\d+)$/i);
    return {
      base: baseMatch ? `WAB2025${baseMatch[1]}` : val,
      relation: "MAIN",
      index: null,
    };
  }
  const baseNum = match[1];
  const relGroup1 = match[2]; // W, M, F, H
  const idxGroup1 = match[3];
  const relGroup2 = match[4]; // D, S, B
  const idxGroup2 = match[5];

  if (relGroup1) {
    return {
      base: `WAB2025${baseNum}`,
      relation: relGroup1,
      index: idxGroup1 ? parseInt(idxGroup1, 10) : null,
    };
  } else {
    return {
      base: `WAB2025${baseNum}`,
      relation: relGroup2,
      index: parseInt(idxGroup2, 10),
    };
  }
}

function normalizeNameLoose(name) {
  if (!name) return "";
  let n = String(name).trim().replace(/\s+/g, " ");
  // Arabic normalization
  n = n.replace(/[أإآ]/g, "ا");
  n = n.replace(/ة/g, "ه");
  n = n.replace(/ى/g, "ي");
  return n;
}

function birthKey(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

function sortMembersByBirth(members) {
  return [...members].sort((a, b) => {
    const aTime = a.birthDate ? new Date(a.birthDate).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.birthDate ? new Date(b.birthDate).getTime() : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.name.localeCompare(b.name, "ar");
  });
}

function pickTopRelation(votes) {
  let maxCount = -1;
  let best = "MAIN";
  for (const [rel, count] of votes.entries()) {
    if (count > maxCount) {
      maxCount = count;
      best = rel;
    }
  }
  return best;
}

function buildFamilyStandardizationPlan(args) {
  const { familyBase, systemRows, truthRows } = args;

  let displayBase = familyBase;
  if (args.anchorPreferredCard) {
    const rawBase = buildFamilyNumberingBaseFromCanonical(args.anchorPreferredCard);
    if (canonicalizeCardNumber(rawBase) === familyBase) {
      displayBase = rawBase;
    }
  }

  const personMap = new Map();

  const getOrCreatePerson = (name, birthDate) => {
    const norm = normalizeNameLoose(name);
    const bKey = birthKey(birthDate);
    const key = norm && bKey ? `${norm}::${bKey}` : "";
    if (!key) return null;

    if (!personMap.has(key)) {
      personMap.set(key, {
        personKey: key,
        name: name.trim(),
        birthDate: bKey,
        currentCards: new Set(),
        systemCards: new Set(),
        truthCards: new Set(),
        sources: new Set(),
        relationVotes: new Map(),
      });
    }
    return personMap.get(key);
  };

  systemRows.forEach((row) => {
    const person = getOrCreatePerson(row.name, row.birth_date);
    if (!person) return;
    person.sources.add("system");
    const card = String(row.card_number ?? "").trim().toUpperCase();
    if (card) {
      person.currentCards.add(card);
      person.systemCards.add(card);
      const parsed = parseFamilySuffixFromCanonical(card);
      const rel = parsed.relation;
      person.relationVotes.set(rel, (person.relationVotes.get(rel) ?? 0) + 1);
    }
  });

  truthRows.forEach((row) => {
    const person = getOrCreatePerson(row.beneficiary_name, row.birth_date);
    if (!person) return;
    person.sources.add("truth");
    const card = String(row.card_number ?? "").trim().toUpperCase();
    if (card) {
      person.currentCards.add(card);
      person.truthCards.add(card);
      const parsed = parseFamilySuffixFromCanonical(card);
      const rel = parsed.relation;
      person.relationVotes.set(rel, (person.relationVotes.get(rel) ?? 0) + 1);
    }
  });

  const relationHasIndex = new Map();
  personMap.forEach((person) => {
    person.currentCards.forEach((card) => {
      const parsed = parseFamilySuffixFromCanonical(card);
      if (parsed.index !== null) {
        relationHasIndex.set(parsed.relation, true);
      }
    });
  });

  const byRelation = new Map();
  personMap.forEach((person) => {
    let relation = pickTopRelation(person.relationVotes);
    if (args.anchorPersonKey && args.anchorPersonKey === person.personKey && args.anchorPreferredCard) {
      const preferredCanonical = canonicalizeCardNumber(args.anchorPreferredCard);
      const preferredParsed = parseFamilySuffixFromCanonical(preferredCanonical);
      relation = preferredParsed.base === familyBase ? preferredParsed.relation : relation;
    }

    if (!byRelation.has(relation)) {
      byRelation.set(relation, []);
    }
    byRelation.get(relation).push(person);
  });

  const targetByPersonKey = new Map();

  const mainMembers = sortMembersByBirth(byRelation.get("MAIN") ?? []);
  if (mainMembers.length > 0) {
    const anchorInMain = args.anchorPersonKey
      ? mainMembers.find((m) => m.personKey === args.anchorPersonKey)
      : null;
    const anchorPrefCard = anchorInMain && args.anchorPreferredCard
      ? String(args.anchorPreferredCard).trim().toUpperCase()
      : null;

    if (anchorInMain && anchorPrefCard) {
      targetByPersonKey.set(anchorInMain.personKey, anchorPrefCard);
      mainMembers.forEach((member) => {
        if (member.personKey === anchorInMain.personKey) return;
        const current = personMap.get(member.personKey);
        const fallback = Array.from(current?.currentCards ?? [])[0] ?? displayBase;
        targetByPersonKey.set(member.personKey, fallback);
      });
    } else {
      targetByPersonKey.set(mainMembers[0].personKey, displayBase);
      for (const extraMain of mainMembers.slice(1)) {
        const current = personMap.get(extraMain.personKey);
        const fallback = Array.from(current?.currentCards ?? [])[0] ?? displayBase;
        targetByPersonKey.set(member.personKey, fallback);
      }
    }
  }

  const buildForIndexedRelation = (
    relation,
    alwaysIndexed,
  ) => {
    const members = sortMembersByBirth(byRelation.get(relation) ?? []);
    if (members.length === 0) return;

    const anchorInGroup = args.anchorPersonKey
      ? members.find((m) => m.personKey === args.anchorPersonKey)
      : null;
    const anchorPrefCard = anchorInGroup && args.anchorPreferredCard
      ? String(args.anchorPreferredCard).trim().toUpperCase()
      : null;

    if (!alwaysIndexed && members.length === 1 && !anchorPrefCard) {
      targetByPersonKey.set(members[0].personKey, `${displayBase}${relation}`);
      return;
    }

    if (members.length === 1 && anchorPrefCard) {
      targetByPersonKey.set(members[0].personKey, anchorPrefCard);
      return;
    }

    let anchorIndex = null;
    if (anchorPrefCard) {
      const parsed = parseFamilySuffixFromCanonical(anchorPrefCard);
      anchorIndex = parsed.index;
    }

    const usedCards = new Set();
    if (anchorPrefCard && anchorInGroup) {
      targetByPersonKey.set(anchorInGroup.personKey, anchorPrefCard);
      usedCards.add(anchorPrefCard);
    }

    let nextIdx = 1;
    members.forEach((member) => {
      if (anchorInGroup && member.personKey === anchorInGroup.personKey) {
        return;
      }

      let targetCard = "";
      while (true) {
        const suffix = alwaysIndexed || nextIdx > 1 || anchorIndex !== null
          ? `${relation}${nextIdx}`
          : relation;
        targetCard = `${displayBase}${suffix}`;
        if (!usedCards.has(targetCard)) {
          break;
        }
        nextIdx++;
      }
      targetByPersonKey.set(member.personKey, targetCard);
      usedCards.add(targetCard);
      nextIdx++;
    });
  };

  buildForIndexedRelation("F", relationHasIndex.get("F") ?? false);
  buildForIndexedRelation("M", relationHasIndex.get("M") ?? false);
  buildForIndexedRelation("W", relationHasIndex.get("W") ?? false);
  buildForIndexedRelation("H", relationHasIndex.get("H") ?? false);
  buildForIndexedRelation("S", relationHasIndex.get("S") ?? true);
  buildForIndexedRelation("D", relationHasIndex.get("D") ?? true);
  buildForIndexedRelation("B", relationHasIndex.get("B") ?? true);

  const plan = Array.from(personMap.values())
    .map((person) => ({
      person_key: person.personKey,
      name: person.name,
      birth_date: person.birthDate,
      relation_code: parseFamilySuffixFromCanonical(
        targetByPersonKey.get(person.personKey) ?? displayBase,
      ).relation,
      target_card: targetByPersonKey.get(person.personKey) ?? Array.from(person.currentCards)[0] ?? displayBase,
      current_cards: Array.from(person.currentCards).sort(),
      sources: Array.from(person.sources),
      system_cards: Array.from(person.systemCards).sort(),
      truth_cards: Array.from(person.truthCards).sort(),
    }))
    .sort((a, b) => {
      const getRelationRank = (relationCode) => {
        if (relationCode === "MAIN" || !relationCode) return 1;
        if (relationCode === "W" || relationCode === "H") return 2;
        if (relationCode === "F") return 3;
        if (relationCode === "M") return 4;
        if (relationCode === "S") return 5;
        if (relationCode === "D") return 6;
        if (relationCode === "B") return 7;
        return 8;
      };
      const rankA = getRelationRank(a.relation_code);
      const rankB = getRelationRank(b.relation_code);
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const aTime = a.birth_date ? Date.parse(a.birth_date) : Number.POSITIVE_INFINITY;
      const bTime = b.birth_date ? Date.parse(b.birth_date) : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.name.localeCompare(b.name, "ar");
    });

  return { plan, targetByPersonKey, displayBase };
}

async function main() {
  // Let's find فايز عثمان عبدالسلام العبيدي or members of his family
  const systemRows = await prisma.beneficiary.findMany({
    where: {
      name: { contains: "فايز عثمان" },
      deleted_at: null,
    }
  });
  console.log("System rows found:", systemRows.map(r => ({ name: r.name, card: r.card_number, birth: r.birth_date })));

  // Let's find matching cards in CardIssuanceRegistryAll
  const familyBase = "WAB20253801"; // canonical family base
  const dbSystemRows = await prisma.$queryRaw`
    SELECT
      b.id,
      b.name,
      b.card_number,
      REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') AS canonical_card,
      b.birth_date,
      b.created_at
    FROM "Beneficiary" b
    WHERE b.deleted_at IS NULL
      AND COALESCE(
        SUBSTRING(REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1') FROM '^(WAB2025[0-9]+)'),
        REGEXP_REPLACE(UPPER(BTRIM(b.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')
      ) = ${familyBase}
  `;

  const dbTruthRows = await prisma.$queryRaw`
    SELECT
      t.id,
      t.card_number,
      COALESCE(t.canonical_card, REGEXP_REPLACE(t.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')) AS canonical_card,
      t.beneficiary_name,
      t.birth_date
    FROM "CardIssuanceRegistryAll" t
    WHERE COALESCE(
        SUBSTRING(COALESCE(t.canonical_card, REGEXP_REPLACE(t.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1')) FROM '^(WAB2025[0-9]+)'),
        COALESCE(t.canonical_card, REGEXP_REPLACE(t.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\1'))
      ) = ${familyBase}
  `;

  console.log("DB System Rows count:", dbSystemRows.length);
  console.log("DB Truth Rows count:", dbTruthRows.length);

  // Let's run with anchorPreferredCard = "WAB202503801D5"
  const result = buildFamilyStandardizationPlan({
    familyBase,
    systemRows: dbSystemRows,
    truthRows: dbTruthRows,
    anchorPersonKey: "رتاج فايز عثمان العبيدي::1999-08-10",
    anchorPreferredCard: "WAB202503801D5",
  });

  console.log("Result displayBase:", result.displayBase);
  console.log("Result plan target cards:");
  result.plan.forEach(p => {
    console.log(`- Name: ${p.name}, Birth: ${p.birth_date}, Target: ${p.target_card}, Current: ${p.current_cards.join(", ")}`);
  });

  prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
});
