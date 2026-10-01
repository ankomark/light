"""The marketplace's categories: a fixed list a seller picks from.

Sellers used to type a category, and each new spelling made a new one
("Shoes", "shoe", "Viatu", "Sneakers for men"...), so the list grew with
every product and browsing by category stopped working. Now there is this
list; staff can still add to it in the admin.

`major_for(text)` puts a free-typed name (an old category, a title) into
the category it belongs to, by the words in it, in English or Swahili. It
moved the products already listed, and it is what an old app build's typed
category is read as.
"""
import re

OTHER = 'Other'

# (name, words...) — first match wins, so the specific come first. Words
# match the start of a word in the text ("bag" matches "bags", not "cabbage").
MAJOR = [
    ('Phones & Tablets', 'phone', 'smartphone', 'cellphone', 'mobile', 'simu', 'tablet', 'ipad', 'iphone',
     'samsung', 'tecno', 'infinix'),
    ('Computers & Laptops', 'laptop', 'computer', 'pc', 'kompyuta', 'desktop', 'macbook', 'printer',
     'monitor', 'keyboard', 'mouse'),
    ('Electronics', 'electronic', 'electric', 'umeme', 'tv', 'television', 'runinga', 'radio', 'speaker',
     'headphone', 'earphone', 'earbud', 'camera', 'kamera', 'gadget', 'charger', 'solar', 'appliance',
     'fridge', 'cooker', 'microwave', 'blender', 'iron', 'battery', 'cable', 'bulb'),
    ('Shoes', 'shoe', 'sneaker', 'boot', 'sandal', 'viatu', 'kiatu', 'footwear', 'heel', 'slipper'),
    ('Bags & Accessories', 'bag', 'handbag', 'backpack', 'mkoba', 'begi', 'wallet', 'belt', 'cap', 'hat',
     'scarf', 'scarves', 'sunglass', 'accessor'),
    ('Jewellery & Watches', 'jewel', 'pendant', 'ring', 'necklace', 'bracelet', 'earring', 'watch', 'saa', 'vito'),
    ('Clothing & Fashion', 'cloth', 'shirt', 'tshirt', 'dress', 'fashion', 'wear', 'apparel', 'nguo',
     'mavazi', 'gauni', 'suit', 'trouser', 'jeans', 'skirt', 'jacket', 'sweater', 'kitenge', 'uniform',
     'blouse', 'shorts'),
    ('Health & Beauty', 'beauty', 'cosmetic', 'makeup', 'hair', 'urembo', 'skin', 'lotion', 'perfume',
     'soap', 'health', 'afya', 'medic', 'dawa', 'pharma', 'vitamin', 'herbal', 'wig'),
    ('Books & Bibles', 'book', 'vitabu', 'kitabu', 'bible', 'biblia', 'hymn', 'novel', 'devotional',
     'lesson', 'quarterly', 'magazine', 'literature'),
    ('Music & Instruments', 'music', 'muziki', 'instrument', 'guitar', 'piano', 'drum', 'violin',
     'trumpet', 'saxophone', 'microphone', 'cd', 'album'),
    ('Furniture', 'furniture', 'samani', 'sofa', 'chair', 'table', 'bed', 'kitanda', 'wardrobe',
     'cabinet', 'shelf', 'desk', 'mattress', 'godoro'),
    ('Farming & Agriculture', 'farm', 'shamba', 'kilimo', 'agri', 'seed', 'mbegu', 'plant', 'garden',
     'fertili', 'mbolea', 'livestock', 'mifugo', 'poultry', 'chicken', 'kuku', 'cow', 'goat', 'feed',
     'tool'),
    ('Food & Drinks', 'food', 'chakula', 'grocer', 'fruit', 'vegetable', 'snack', 'drink', 'kinywaji',
     'juice', 'honey', 'asali', 'flour', 'unga', 'rice', 'mchele', 'cake', 'bread', 'tea', 'coffee',
     'spice', 'potato', 'viazi', 'maize', 'mahindi', 'beans', 'maharagwe', 'milk', 'maziwa', 'egg', 'mayai'),
    ('Home & Kitchen', 'kitchen', 'jiko', 'utensil', 'cook', 'pot', 'sufuria', 'plate', 'cup', 'home',
     'house', 'nyumba', 'decor', 'carpet', 'rug', 'curtain', 'bedding', 'blanket', 'towel', 'clean'),
    ('Vehicles & Parts', 'car', 'vehicle', 'gari', 'magari', 'motor', 'pikipiki', 'tyre', 'tire',
     'spare', 'auto', 'toyota', 'nissan', 'subaru', 'mazda', 'honda', 'isuzu', 'boda'),
    ('Baby & Kids', 'baby', 'kid', 'child', 'mtoto', 'watoto', 'toy', 'game', 'mchezo', 'michezo',
     'diaper', 'school'),
    ('Sports & Fitness', 'sport', 'fitness', 'gym', 'ball', 'mpira', 'bike', 'bicycle', 'baiskeli',
     'exercise', 'jersey'),
    ('Art & Crafts', 'art', 'craft', 'sanaa', 'paint', 'handmade', 'bead', 'carving', 'stationery',
     'office'),
    ('Services', 'service', 'huduma', 'repair', 'design', 'tailor', 'catering', 'photograph',
     'tuition', 'cleaning', 'delivery', 'printing'),
]

NAMES = [name for name, *_ in MAJOR] + [OTHER]


def _tokens(text):
    return re.findall(r'[a-z]+', (text or '').lower())


def major_for(*texts):
    """The major category the first of `texts` that says anything belongs
    to (an exact name wins); Other when none does."""
    for text in texts:
        if not text:
            continue
        clean = text.strip().lower()
        for name in NAMES:
            if clean == name.lower():
                return name
        tokens = _tokens(text)
        for name, *words in MAJOR:
            if any(tok.startswith(w) for w in words for tok in tokens):
                return name
    return OTHER
