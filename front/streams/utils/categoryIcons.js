// A picture for a product category that says what it is: a circuit chip for
// electronics, a T-shirt for clothes, a shoe for shoes. Categories are named
// by sellers (in English or Swahili), so the name is matched by the words in
// it; anything unrecognised gets a shopping bag.
//
// Icons are MaterialCommunityIcons names (@expo/vector-icons); each has its
// own colour so a row of them reads at a glance.

const RULES = [
  // [icon, colour, words...] — first match wins, so the specific come first.
  ['headphones', '#7E57C2', 'headphone', 'earphone', 'earbud', 'speaker', 'audio', 'sound'],
  ['cellphone', '#5C6BC0', 'phone', 'cellphone', 'mobile', 'simu', 'smartphone', 'tablet'],
  ['laptop', '#3949AB', 'laptop', 'computer', 'pc', 'kompyuta', 'desktop'],
  ['television-classic', '#546E7A', 'tv', 'television', 'runinga', 'screen'],
  ['camera', '#455A64', 'camera', 'kamera', 'photo'],
  ['chip', '#1E88E5', 'electronic', 'electric', 'umeme', 'gadget', 'tech', 'appliance', 'vifaa vya umeme'],
  ['shoe-sneaker', '#8D6E63', 'shoe', 'sneaker', 'boot', 'sandal', 'viatu', 'kiatu', 'footwear'],
  ['tshirt-crew', '#EC407A', 'cloth', 'shirt', 'dress', 'fashion', 'wear', 'apparel', 'nguo', 'mavazi', 'gauni', 'suit'],
  ['bag-personal', '#AD1457', 'bag', 'handbag', 'backpack', 'mkoba', 'begi'],
  ['diamond-stone', '#00ACC1', 'jewel', 'jewelry', 'jewellery', 'ring', 'necklace', 'watch', 'saa', 'vito'],
  ['lipstick', '#D81B60', 'beauty', 'cosmetic', 'makeup', 'hair', 'urembo', 'skin'],
  ['book-open-variant', '#6D4C41', 'book', 'vitabu', 'kitabu', 'novel', 'literature'],
  ['book-cross', '#5D4037', 'bible', 'biblia', 'hymn', 'church', 'kanisa', 'devotional', 'christian'],
  ['guitar-acoustic', '#F4511E', 'music', 'instrument', 'guitar', 'muziki', 'piano', 'keyboard', 'drum'],
  ['pencil-ruler', '#FB8C00', 'stationery', 'school', 'office', 'shule', 'pen'],
  ['food-apple', '#43A047', 'food', 'grocer', 'chakula', 'fruit', 'vegetable', 'snack', 'drink', 'kinywaji'],
  ['sprout', '#2E7D32', 'farm', 'agri', 'kilimo', 'seed', 'plant', 'garden', 'shamba'],
  ['sofa', '#795548', 'furniture', 'samani', 'sofa', 'chair', 'table', 'bed'],
  ['silverware-fork-knife', '#8E24AA', 'kitchen', 'jiko', 'utensil', 'cook', 'home', 'house', 'nyumba', 'decor'],
  ['baby-carriage', '#F06292', 'baby', 'kid', 'child', 'mtoto', 'watoto'],
  ['toy-brick', '#FFB300', 'toy', 'game', 'mchezo', 'michezo'],
  ['soccer', '#388E3C', 'sport', 'fitness', 'gym', 'ball', 'mpira'],
  ['medical-bag', '#E53935', 'health', 'medic', 'pharma', 'afya', 'dawa'],
  ['car', '#37474F', 'car', 'vehicle', 'motor', 'gari', 'magari', 'auto', 'spare'],
  ['bike', '#00897B', 'bike', 'bicycle', 'baiskeli', 'pikipiki'],
  ['palette', '#C2185B', 'art', 'craft', 'sanaa', 'paint', 'handmade'],
  ['hammer-wrench', '#607D8B', 'tool', 'hardware', 'repair', 'service', 'huduma', 'build'],
  ['paw', '#8D6E63', 'pet', 'animal', 'mnyama', 'livestock', 'mifugo'],
];

const FALLBACK = { icon: 'shopping-outline', color: '#FF8F00' };

/** { icon, color } for a category name. Words are matched at the start of
 *  a word in the name, so "Scarves" is not a car and "Headphones" not a phone. */
export const categoryIcon = (name = '') => {
  const text = String(name).toLowerCase();
  const tokens = text.split(/[^a-z]+/).filter(Boolean);
  const hit = RULES.find(([, , ...words]) => words.some((w) => (
    w.includes(' ') ? text.includes(w) : tokens.some((tok) => tok.startsWith(w))
  )));
  return hit ? { icon: hit[0], color: hit[1] } : FALLBACK;
};
