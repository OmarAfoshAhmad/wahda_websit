const fs = require('fs');

function fixFile(filePath) {
  let code = fs.readFileSync(filePath, 'utf8');

  // Fix query filters
  code = code.replace(/AND \(\s*\$\{\s*query\s*\}\s*=\s*''\s*OR card_number ILIKE \$\{\`%\$\{query\}%\`\}\s*OR name ILIKE \$\{\`%\$\{query\}%\`\}\s*\)/g, 
    "${query ? Prisma.sql`AND (card_number ILIKE ${'%' + query + '%'} OR name ILIKE ${'%' + query + '%'})` : Prisma.empty}");

  code = code.replace(/AND \(\s*\$\{\s*query\s*\}\s*=\s*''\s*OR card_number ILIKE \$\{\`%\$\{query\}%\`\}\s*OR COALESCE\(beneficiary_name, ''\) ILIKE \$\{\`%\$\{query\}%\`\}\s*OR COALESCE\(source_file, ''\) ILIKE \$\{\`%\$\{query\}%\`\}\s*\)/g, 
    "${query ? Prisma.sql`AND (card_number ILIKE ${'%' + query + '%'} OR COALESCE(beneficiary_name, '') ILIKE ${'%' + query + '%'} OR COALESCE(source_file, '') ILIKE ${'%' + query + '%'})` : Prisma.empty}");

  // Fix cityFilter
  code = code.replace(/WHERE \(\$\{cityFilter\} = '' OR city = \$\{cityFilter\}\)/g, 
    "WHERE 1=1 ${cityFilter ? Prisma.sql`AND city = ${cityFilter}` : Prisma.empty}");
  
  code = code.replace(/WHERE \(\$\{cityFilter\} = '' OR f\.city = \$\{cityFilter\}\)/g, 
    "WHERE 1=1 ${cityFilter ? Prisma.sql`AND f.city = ${cityFilter}` : Prisma.empty}");

  // Fix batchFilter
  code = code.replace(/AND \(\s*\(\$\{batchFilter\} = ''\)\s*OR \(\$\{isNoBatchFilter\} = true AND \(batch_number IS NULL OR BTRIM\(batch_number\) = ''\)\)\s*OR \(\$\{isNoBatchFilter\} = false AND batch_number = \$\{batchFilter\}\)\s*\)/g, 
    "${isNoBatchFilter ? Prisma.sql`AND (batch_number IS NULL OR BTRIM(batch_number) = '')` : (batchFilter ? Prisma.sql`AND batch_number = ${batchFilter}` : Prisma.empty)}");

  code = code.replace(/AND \(\s*\(\$\{batchFilter\} = ''\)\s*OR \(\$\{isNoBatchFilter\} = true AND \(f\.batch_number IS NULL OR BTRIM\(f\.batch_number\) = ''\)\)\s*OR \(\$\{isNoBatchFilter\} = false AND f\.batch_number = \$\{batchFilter\}\)\s*\)/g, 
    "${isNoBatchFilter ? Prisma.sql`AND (f.batch_number IS NULL OR BTRIM(f.batch_number) = '')` : (batchFilter ? Prisma.sql`AND f.batch_number = ${batchFilter}` : Prisma.empty)}");

  // Fix booleans
  const bools = [
    'onlyInSystemNotInRegistry',
    'onlyLegacyNoBatch',
    'onlyFamilyNumberingMismatch',
    'onlyMissingInSystem',
    'onlyDemographicMismatch'
  ];

  bools.forEach(b => {
    // We look for: AND ( ${b} = false OR ( ... ) )
    // Because the inner content can span many lines, we write a custom parser
    const regex = new RegExp(`AND \\(\\s*\\$\\{${b}\\}\\s*=\\s*false\\s*OR \\(([\\s\\S]*?)\\)\\s*\\)`, 'g');
    // Wait, the regex might fail if there are nested parentheses inside the OR block.
    // Let's use a simpler approach.
    let index = 0;
    while(true) {
        let matchStr = `AND \\(\\s*\\$\\{${b}\\}\\s*=\\s*false\\s*OR \\(`;
        let matchRegex = new RegExp(matchStr);
        let match = code.match(matchRegex);
        if(!match) break;
        
        let startIdx = match.index;
        let pCount = 1;
        let endIdx = startIdx + match[0].length;
        
        while (pCount > 0 && endIdx < code.length) {
            if (code[endIdx] === '(') pCount++;
            if (code[endIdx] === ')') pCount--;
            endIdx++;
        }
        
        // At this point, endIdx is just past the inner )
        // We also have the outer AND ( ... ) to close.
        let outerPCount = 1; // Since we matched the inner OR (, there's an outer AND (
        // Actually, the matchStr consumed the outer `AND (`, so outerPCount is 1. We just consumed the inner `(`, which closed when pCount reached 0.
        // Wait, `match[0]` consumes `AND ( \${b} = false OR (`
        // So at `endIdx`, the inner `(` is closed. Then there is whitespace and a closing `)` for the outer.
        while (code[endIdx] !== ')' && endIdx < code.length) {
            endIdx++;
        }
        endIdx++; // include the final ')'
        
        let fullMatch = code.substring(startIdx, endIdx);
        let innerContent = fullMatch.substring(match[0].length, endIdx - 1); // remove outer wrapper
        // remove the last `)` from innerContent which was the inner closing parens
        innerContent = innerContent.substring(0, innerContent.lastIndexOf(')'));
        
        code = code.substring(0, startIdx) + 
               `\${${b} ? Prisma.sql\`AND (${innerContent.trim()})\` : Prisma.empty}` + 
               code.substring(endIdx);
    }
  });

  fs.writeFileSync(filePath, code);
  console.log(`Updated ${filePath}`);
}

fixFile('c:/Users/Omar/waad_temp_website/src/app/admin/truth-registry/page.tsx');
