const existingSystemBens = [
  {
    "id": "cmn9d6qpn00utnz1n08qyjb2q",
    "card_number": "WAB2025104400S1",
    "name": "ليث سند عوض الهوني",
    "is_legacy_card": false
  }
];

const empNum = "104400";
const matchedBaseCard = "WAB2025104400";
const relCode = "S";
let maxSuffix = 0;
const prefixToMatch = (matchedBaseCard + relCode).toLowerCase();

console.log("prefixToMatch:", prefixToMatch);

existingSystemBens.forEach(b => {
  if (b.is_legacy_card) return;
  const cardLower = b.card_number.toLowerCase();
  console.log("Checking:", cardLower);
  if (cardLower.startsWith(prefixToMatch)) {
    const suffixStr = cardLower.substring(prefixToMatch.length);
    const suffixNum = parseInt(suffixStr, 10);
    console.log("suffixStr:", suffixStr, "suffixNum:", suffixNum);
    if (!isNaN(suffixNum) && suffixNum > maxSuffix) {
      maxSuffix = suffixNum;
    }
  }
});

console.log("maxSuffix:", maxSuffix);
