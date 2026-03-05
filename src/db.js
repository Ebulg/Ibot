// src/db.js — Conexión a MongoDB
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'Ibot';

let client;
let db;

export async function connectDB() {
  if (db) return db;

  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
    console.log(`✅ Conectado a MongoDB (${dbName})`);
    return db;
  } catch (err) {
    console.error('❌ Error de conexión a MongoDB:', err);
    process.exit(1);
  }
}
