// database.js - runtime backend selector (MongoDB when MONGODB_URI is present, otherwise SQLite)

const useMongo = !!(process.env.MONGODB_URI && process.env.MONGODB_URI.trim() !== "");

if (useMongo) {
  console.log("🔀 database.js: using MongoDB backend (database-mongo.js)");
  module.exports = require("./database-mongo.js");
} else {
  console.log("🔀 database.js: using SQLite backend (database-sqlite.js)");
  module.exports = require("./database-sqlite.js");
}
