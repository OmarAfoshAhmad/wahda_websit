const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const targetDir = "C:\\Users\\Omar\\Desktop\\شركة وعد\\JFZ\\الدفعات المنظمة";
const outputFilePath = path.join(targetDir, "الدفعات المدمجة للأسنان.xlsx");

// Helper to normalize name (Arabic normalization)
function getArabicNormalization(text) {
  if (!text) return "";
  return text
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

// Extract batch number from filename (e.g. "الدفعة 16.xlsx" -> 16, "متفرقات.xlsx" -> 0)
function getBatchNumberFromFilename(filename) {
  const match = filename.match(/الدفعة\s*(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0; // Default for files like "متفرقات"
}

// Verify if a string is a valid Libyan National Number (12 digits, starting with 1 or 2)
function isValidNationalNumber(val) {
  if (!val) return false;
  const cleaned = val.trim();
  return /^[12]\d{11}$/.test(cleaned);
}

function mergeExcelFiles() {
  if (!fs.existsSync(targetDir)) {
    console.error("Target directory does not exist:", targetDir);
    return;
  }

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith(".xlsx") && f !== "الدفعات المدمجة للأسنان.xlsx");
  console.log(`Found ${files.length} files to merge.`);

  // We will map unique composite keys to the best record
  // Key: normalizedName + "|" + birthYear
  const mergedMap = new Map();
  // We also track by valid National Number
  const nationalIdToKey = new Map();

  let totalRowsRead = 0;

  files.forEach(file => {
    const filePath = path.join(targetDir, file);
    const fileBatch = getBatchNumberFromFilename(file);

    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      console.log(`Processing file: ${file} (Batch: ${fileBatch}) | Rows: ${data.length}`);
      totalRowsRead += data.length;

      data.forEach(row => {
        // Extract fields
        const cardKey = Object.keys(row).find(k => k.trim() === "الرقم ت" || k.trim().toLowerCase() === "card_number");
        const card = cardKey ? String(row[cardKey]).trim().toUpperCase() : "";

        const nameKey = Object.keys(row).find(k => k.trim() === "الاسم" || k.trim().toLowerCase() === "name");
        const name = nameKey ? String(row[nameKey]).trim() : "";

        const relKey = Object.keys(row).find(k => k.trim() === "الصلة" || k.trim().toLowerCase() === "relationship");
        const relation = relKey ? String(row[relKey]).trim() : "";

        const birthKey = Object.keys(row).find(k => k.trim() === "المواليد" || k.trim().toLowerCase() === "birth_year");
        const birthYear = birthKey ? String(row[birthKey]).trim() : "";

        const natKey = Object.keys(row).find(k => k.trim() === "الرقم الوطني" || k.trim().toLowerCase() === "national_number");
        const nationalNumberRaw = natKey ? String(row[natKey]).trim() : "";

        const finKey = Object.keys(row).find(k => k.trim() === "الرقم المالي" || k.trim().toLowerCase() === "financial_number");
        const financialNumber = finKey ? String(row[finKey]).trim() : "";

        const batchKey = Object.keys(row).find(k => k.trim() === "رقم الدفعة" || k.trim().toLowerCase() === "batch_number");
        const rowBatch = batchKey ? parseInt(row[batchKey], 10) : null;
        
        // Final batch number is rowBatch if available, otherwise fileBatch
        const finalBatch = (rowBatch !== null && !isNaN(rowBatch)) ? rowBatch : fileBatch;

        if (!card || !name) {
          // Skip invalid rows without name or card
          return;
        }

        // Clean national number if not valid numeric
        let finalNationalNumber = nationalNumberRaw;
        if (nationalNumberRaw === "مصرية" || nationalNumberRaw === "مصريه" || nationalNumberRaw === "ليبي" || nationalNumberRaw === "ليبية" || nationalNumberRaw === "0") {
          finalNationalNumber = "";
        }

        // Generate composite key
        const normName = getArabicNormalization(name);
        const demoKey = `${normName}|${birthYear}`;

        // Normalized national ID for key matching
        const nationalKey = isValidNationalNumber(finalNationalNumber) ? finalNationalNumber : null;

        const currentRecord = {
          "الرقم المالي": financialNumber,
          "الاسم": name,
          "الصلة": relation,
          "المواليد": birthYear ? parseInt(birthYear, 10) || birthYear : "",
          "الرقم ت": card,
          "الرقم الوطني": finalNationalNumber,
          "رقم الدفعة": finalBatch,
          _batch: finalBatch,
          _file: file
        };

        // Check if this person is already registered
        let existingKey = null;

        if (mergedMap.has(demoKey)) {
          existingKey = demoKey;
        } else if (nationalKey && nationalIdToKey.has(nationalKey)) {
          existingKey = nationalIdToKey.get(nationalKey);
        }

        if (existingKey) {
          const existingRecord = mergedMap.get(existingKey);
          // If the new record belongs to a newer batch, overwrite the existing record
          if (currentRecord._batch > existingRecord._batch) {
            // Remove previous national number key mapping if it changes
            if (isValidNationalNumber(existingRecord["الرقم الوطني"])) {
              nationalIdToKey.delete(existingRecord["الرقم الوطني"]);
            }

            mergedMap.set(demoKey, currentRecord);
            if (nationalKey) {
              nationalIdToKey.set(nationalKey, demoKey);
            }
          }
        } else {
          // New unique record
          mergedMap.set(demoKey, currentRecord);
          if (nationalKey) {
            nationalIdToKey.set(nationalKey, demoKey);
          }
        }
      });
    } catch (e) {
      console.error(`Error reading file ${file}:`, e.message);
    }
  });

  // Convert map to array of final records
  const finalRecords = Array.from(mergedMap.values()).map(rec => {
    // Exclude internal helper fields before writing
    const { _batch, _file, ...rest } = rec;
    return rest;
  });

  console.log(`\n========================================`);
  console.log(`Merge completed successfully!`);
  console.log(`Total rows processed: ${totalRowsRead}`);
  console.log(`Total unique records retained: ${finalRecords.length}`);
  console.log(`Total duplicates removed: ${totalRowsRead - finalRecords.length}`);
  console.log(`========================================`);

  // Write to Excel
  try {
    const newWorksheet = XLSX.utils.json_to_sheet(finalRecords, {
      header: ["الرقم المالي", "الاسم", "الصلة", "المواليد", "الرقم ت", "الرقم الوطني", "رقم الدفعة"]
    });
    
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "المستفيدين المدمجين");

    XLSX.writeFile(newWorkbook, outputFilePath);
    console.log(`File saved successfully at:\n${outputFilePath}`);
  } catch (err) {
    console.error(`Error writing merged file:`, err.message);
  }
}

mergeExcelFiles();
