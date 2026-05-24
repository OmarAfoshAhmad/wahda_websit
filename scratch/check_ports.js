const { execSync } = require("child_process");

try {
  console.log("Checking listening ports 3000-3005:");
  const output = execSync("netstat -ano").toString();
  const lines = output.split("\n");
  const filtered = lines.filter(line => 
    line.includes("LISTENING") && 
    (line.includes(":3000") || line.includes(":3001") || line.includes(":3002") || line.includes(":3003") || line.includes(":3004") || line.includes(":3005"))
  );
  console.log(filtered.join("\n"));
  
  console.log("\nProcess Details:");
  const pids = new Set(filtered.map(line => line.trim().split(/\s+/).pop()).filter(Boolean));
  for (const pid of pids) {
    try {
      const taskOutput = execSync(`tasklist /FI "PID eq ${pid}"`).toString();
      console.log(taskOutput);
    } catch (e) {
      console.log(`Failed to get details for PID ${pid}`);
    }
  }
} catch (err) {
  console.error("Error checking ports:", err.message);
}
