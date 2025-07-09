export const extractYoutubeId = (url) => {
  if (!url) return null;
  
  const patterns = [
    /youtube\.com\/live\/([^"&?\/\s]{11})/,
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|watch\?v=)|youtu\.be\/)([^"&?\/\s]{11})/,
    /youtu\.be\/([^"&?\/\s]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
};