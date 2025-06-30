import * as SQLite from 'expo-sqlite';
import hymnsData from './hymns.json'; // Your JSON data

const db = SQLite.openDatabase('sda_hymnal.db');

export const importHymns = () => {
  db.transaction(tx => {
    hymnsData.forEach(hymn => {
      tx.executeSql(
        `INSERT INTO Hymns 
        (Number, Title, Verse_1, Verse_2, Verse_3, Section) 
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          hymn.number,
          hymn.title,
          hymn.verses[0],
          hymn.verses[1],
          hymn.verses[2],
          hymn.section || 0
        ]
      );
    });
  });
};

// Call this once when setting up your app
// importHymns();