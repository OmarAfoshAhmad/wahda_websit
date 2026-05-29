const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'app', 'admin', 'truth-registry', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// Replace `NOT IN` subquery for `onlyMissingInSystem`
// The pattern looks for REGEXP_REPLACE(...) NOT IN (SELECT ... FROM "Beneficiary" ...)
const missingInSystemPattern = /REGEXP_REPLACE\((f\.)?card_number_upper,\s*'\^WAB20250\*\(\[1-9\]\[0-9\]\*\|0\)',\s*'WAB2025\\\\1'\)\s*NOT\s*IN\s*\(\s*SELECT\s*REGEXP_REPLACE\(UPPER\(BTRIM\(card_number\)\),\s*'\^WAB20250\*\(\[1-9\]\[0-9\]\*\|0\)',\s*'WAB2025\\\\1'\)\s*FROM\s*"Beneficiary"\s*WHERE\s*deleted_at\s*IS\s*NULL\s*\)/g;

const missingInSystemReplacement = `NOT EXISTS (
                    SELECT 1
                    FROM "Beneficiary" __b_missing
                    WHERE __b_missing.deleted_at IS NULL
                      AND REGEXP_REPLACE(UPPER(BTRIM(__b_missing.card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1') =
                          REGEXP_REPLACE($1card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1')
                  )`;
content = content.replace(missingInSystemPattern, missingInSystemReplacement);


// Replace `NOT IN` subquery for `onlyInSystemNotInRegistry`
const inSystemPattern = /REGEXP_REPLACE\(UPPER\(BTRIM\(card_number\)\),\s*'\^WAB20250\*\(\[1-9\]\[0-9\]\*\|0\)',\s*'WAB2025\\\\1'\)\s*NOT\s*IN\s*\(\s*SELECT\s*REGEXP_REPLACE\(card_number_upper,\s*'\^WAB20250\*\(\[1-9\]\[0-9\]\*\|0\)',\s*'WAB2025\\\\1'\)\s*FROM\s*"CardIssuanceRegistryAll"\s*WHERE\s*card_number_upper\s*IS\s*NOT\s*NULL\s*\)/g;

const inSystemReplacement = `NOT EXISTS (
                  SELECT 1
                  FROM "CardIssuanceRegistryAll" __t_insys
                  WHERE __t_insys.card_number_upper IS NOT NULL
                    AND REGEXP_REPLACE(__t_insys.card_number_upper, '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1') =
                        REGEXP_REPLACE(UPPER(BTRIM(card_number)), '^WAB20250*([1-9][0-9]*|0)', 'WAB2025\\\\1')
                )`;
content = content.replace(inSystemPattern, inSystemReplacement);

fs.writeFileSync(filePath, content, 'utf-8');
console.log("Replacements done.");
