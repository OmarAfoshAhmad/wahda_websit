const fs = require('fs');

function fixFile(filePath) {
  let code = fs.readFileSync(filePath, 'utf8');

  const bools = [
    'onlyLegacyHasBatch',
    'onlyFamilyNumberingMismatch',
    'onlyDemographicMismatch',
    'onlyMultiPersonCards',
    'onlyMultiBatch'
  ];

  bools.forEach(b => {
    while(true) {
        let matchRegex = new RegExp(`AND \\(\\s*\\$\\{${b}\\}\\s*=\\s*false\\s*OR\\s+`);
        let match = code.match(matchRegex);
        if(!match) break;
        
        let startIdx = match.index;
        let pCount = 1; // For the outer `AND (`
        let endIdx = startIdx + match[0].length;
        
        // Find the matching closing parenthesis for `AND (`
        while (pCount > 0 && endIdx < code.length) {
            if (code[endIdx] === '(') pCount++;
            if (code[endIdx] === ')') pCount--;
            endIdx++;
        }
        
        let fullMatch = code.substring(startIdx, endIdx);
        let innerContent = fullMatch.substring(match[0].length, fullMatch.length - 1); // remove outer wrapper and last ')'
        
        code = code.substring(0, startIdx) + 
               `\${${b} ? Prisma.sql\`AND (${innerContent.trim()})\` : Prisma.empty}` + 
               code.substring(endIdx);
    }
  });

  fs.writeFileSync(filePath, code);
  console.log(`Updated ${filePath}`);
}

fixFile('c:/Users/Omar/waad_temp_website/src/app/admin/truth-registry/page.tsx');
