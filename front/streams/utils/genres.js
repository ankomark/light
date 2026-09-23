/** A genre's name in the app's language (strings `genre.<slug>`), else the
 *  name the server has for it (genres added in the admin). */
export const genreName = (t, genre) => {
  if (!genre) return '';
  const key = `genre.${genre.slug}`;
  const label = t(key);
  return label && label !== key ? label : (genre.name || genre.slug);
};
