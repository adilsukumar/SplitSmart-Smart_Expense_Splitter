const fs = require("fs");

const config = `const CONFIG = {
  SUPABASE_URL: "${process.env.SUPABASE_URL}",
  SUPABASE_ANON_KEY: "${process.env.SUPABASE_ANON_KEY}",
  GROQ_API_KEY: "${process.env.GROQ_API_KEY}",
  GROQ_URL: "https://api.groq.com/openai/v1/chat/completions",
  GROQ_MODEL: "llama-3.3-70b-versatile"
};`;

fs.writeFileSync("js/config.js", config);
console.log("config.js generated successfully");
