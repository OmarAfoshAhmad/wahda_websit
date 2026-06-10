const fs = require('fs');
const path = require('path');

const files = [
  'src/components/optics-add-transaction-modal.tsx',
  'src/components/optics-deduct/OpticsBeneficiaryCard.tsx',
  'src/components/optics-deduct/OpticsDeductContext.tsx',
  'src/components/optics-deduct/OpticsDeductionAction.tsx',
  'src/components/optics-deduct/OpticsSearchEngine.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content
    .replace(/DENTAL/g, 'OPTICS')
    .replace(/dental/g, 'optics')
    .replace(/الأسنان/g, 'البصريات')
    .replace(/أسنان/g, 'بصريات')
    .replace(/Dental/g, 'Optics');
  fs.writeFileSync(file, content);
});
console.log('done replacing in optics deduct folder and modal');
