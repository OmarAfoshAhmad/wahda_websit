const fs = require("fs");
const path = require("path");

function searchFile(filePath, query) {
  if (!fs.existsSync(filePath)) {
    console.log(`File does not exist: ${filePath}`);
    return;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const matches = [];
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes(query.toLowerCase())) {
      matches.push({ lineNum: idx + 1, content: line.trim() });
    }
  });
  console.log(`Found ${matches.length} matches for "${query}" in ${path.basename(filePath)}:`);
  matches.slice(-15).forEach((m) => {
    console.log(`L${m.lineNum}: ${m.content}`);
  });
}

const statusPath = path.join(__dirname, "..", "status_output.txt");
searchFile(statusPath, "JMR");
searchFile(statusPath, "LCC");
searchFile(statusPath, "الجمارك");
searchFile(statusPath, "الاسمنت");
searchFile(statusPath, "import-jobs");
