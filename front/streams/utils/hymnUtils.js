// Helper function to get verse text regardless of property naming convention
export const getVerse = (hymn, number) => {
  // Try all possible property name variations
  return hymn[`Verse${number}`] ||       // Verse1
         hymn[`Verse ${number}`] ||      // Verse 1
         hymn[`verse${number}`] ||       // verse1
         hymn[`verse ${number}`] || '';  // verse 1
};

// Helper to get all verses as an array
export const getAllVerses = (hymn) => {
  return [1, 2, 3, 4, 5, 6, 7].map(num => ({
    number: num,
    text: getVerse(hymn, num)
  }));
};

// Helper to check if a hymn has any verses
export const hasVerses = (hymn) => {
  return getAllVerses(hymn).some(verse => verse.text && verse.text.trim() !== '');
};

// Helper to get section info
export const getSectionInfo = (sections, sectionId) => {
  return sections.find(s => s.id === sectionId) || {
    id: sectionId,
    title: `Section ${sectionId}`,
    description: `Hymns from section ${sectionId}`
  };
};