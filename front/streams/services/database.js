import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';

// Initialize database
let db = null;

export const initDatabase = async () => {
  try {
    if (!db) {
      // Open database directly without file copying first
      db = SQLite.openDatabase('hymns.db');
      
      // Test the connection
      await new Promise((resolve, reject) => {
        db.transaction(tx => {
          tx.executeSql(
            'SELECT name FROM sqlite_master WHERE type="table"',
            [],
            (_, result) => resolve(result),
            (_, error) => reject(error)
          );
        });
      });
    }
    return db;
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

// Basic query function
export const executeQuery = async (sql, params = []) => {
  if (!db) await initDatabase();
  
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        sql,
        params,
        (_, result) => resolve(result),
        (_, error) => reject(error)
      );
    });
  });
};

export const getHymns = async () => {
  const result = await executeQuery('SELECT * FROM Hymns');
  return result.rows._array;
};