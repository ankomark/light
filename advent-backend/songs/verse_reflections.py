"""A line to carry each verse of the day into the day.

One sentence under the verse: not commentary, which the screen has no room
for, but a nudge from reading it to living it. Written for the curated
selection in devotion.py, keyed the same way, English then Swahili. A
reference without a line here simply shows none — the verse stands alone.

Kept plain on purpose: encouragement and application, nothing that needs a
footnote. The Swahili should be read by a first-language speaker before
launch; tests/test_devotion.py checks that every curated verse has both.
"""

REFLECTIONS = {
    ('Joshua', 1, 9): (
        "Wherever today takes you, you are not going there alone.",
        "Popote siku hii itakapokupeleka, hauendi peke yako."),
    ('Deuteronomy', 31, 6): (
        "Courage is not the absence of fear; it is remembering who walks beside you.",
        "Ujasiri si kukosa hofu; ni kukumbuka ni nani anatembea kando yako."),
    ('Deuteronomy', 31, 8): (
        "He has already gone ahead into the day you are about to enter.",
        "Yeye ameshatangulia katika siku unayokaribia kuingia."),
    ('Exodus', 14, 14): (
        "Some battles are won by being still and letting God act.",
        "Vita vingine hushindwa kwa kutulia na kumwachia Mungu atende."),
    ('Numbers', 6, 24): (
        "Receive this blessing as spoken over you by name today.",
        "Pokea baraka hii kana kwamba imetamkwa juu yako kwa jina leo."),
    ('Numbers', 6, 25): (
        "God turns toward you with grace, not away from you in disappointment.",
        "Mungu anakugeukia kwa neema, si kukuacha kwa kuvunjika moyo."),
    ('Numbers', 6, 26): (
        "The peace you need today is a gift, not a reward to earn.",
        "Amani unayohitaji leo ni zawadi, si tuzo ya kuipata kwa juhudi."),
    ('1 Chronicles', 16, 11): (
        "Seek Him first this morning, before the day asks for your attention.",
        "Mtafute Yeye kwanza asubuhi hii, kabla siku haijadai usikivu wako."),
    ('1 Chronicles', 16, 34): (
        "Name three good things from yesterday and thank Him for each.",
        "Taja mambo matatu mema ya jana na umshukuru kwa kila moja."),
    ('2 Chronicles', 7, 14): (
        "Healing begins on our knees, with humble and honest prayer.",
        "Uponyaji huanza tukiwa magotini, kwa maombi ya unyenyekevu na ukweli."),
    ('Nehemiah', 8, 10): (
        "Your strength today can come from His joy, not from your circumstances.",
        "Nguvu yako leo inaweza kutoka kwa furaha yake, si kwa hali yako."),
    ('Job', 19, 25): (
        "Even in the hardest seasons, your Redeemer lives and has the last word.",
        "Hata katika nyakati ngumu zaidi, Mkombozi wako yu hai na neno la mwisho ni lake."),
    ('Psalms', 1, 1): (
        "Choose carefully whose voices shape your thinking today.",
        "Chagua kwa makini sauti zitakazounda mawazo yako leo."),
    ('Psalms', 4, 8): (
        "Tonight, lay down your worries with your head: He keeps watch.",
        "Usiku huu, weka chini wasiwasi wako pamoja na kichwa chako: Yeye analinda."),
    ('Psalms', 9, 9): (
        "When trouble comes, you have somewhere safe to run.",
        "Taabu ikija, una mahali salama pa kukimbilia."),
    ('Psalms', 16, 8): (
        "Keep the Lord in front of you, and what shakes others need not move you.",
        "Mweke Bwana mbele yako, na kinachowatikisa wengine hakitakuondoa."),
    ('Psalms', 18, 2): (
        "Which of these names for God do you most need today?",
        "Ni lipi kati ya majina haya ya Mungu unalolihitaji zaidi leo?"),
    ('Psalms', 19, 14): (
        "Let this be your prayer before every conversation today.",
        "Hili liwe ombi lako kabla ya kila mazungumzo leo."),
    ('Psalms', 20, 4): (
        "Pray this blessing over someone you love, and tell them you did.",
        "Mwombee mtu unayempenda baraka hii, kisha mwambie umefanya hivyo."),
    ('Psalms', 23, 1): (
        "With the Shepherd leading, you have what you need for today.",
        "Mchungaji akiongoza, una kila unachohitaji kwa leo."),
    ('Psalms', 23, 4): (
        "The dark valley is a road you walk through, and you are not alone on it.",
        "Bonde la giza ni njia ya kupita, na hauko peke yako ndani yake."),
    ('Psalms', 23, 6): (
        "Look back today and notice where goodness and mercy have followed you.",
        "Tazama nyuma leo uone jinsi wema na fadhili zilivyokufuata."),
    ('Psalms', 27, 1): (
        "Name the fear you carry, then set it beside the One who is your light.",
        "Taja hofu unayobeba, kisha iweke kando ya Yeye aliye nuru yako."),
    ('Psalms', 27, 14): (
        "Waiting on God is not wasted time; it is where strength is given.",
        "Kumngoja Mungu si kupoteza muda; ndipo nguvu hutolewa."),
    ('Psalms', 28, 7): (
        "Trust first, and let praise follow the help that comes.",
        "Tanguliza kutumaini, na sifa zifuate msaada unaokuja."),
    ('Psalms', 29, 11): (
        "Ask God for strength for the task, and peace for the heart.",
        "Mwombe Mungu nguvu kwa kazi, na amani kwa moyo."),
    ('Psalms', 30, 5): (
        "If this is your night of weeping, morning is still coming.",
        "Ikiwa huu ni usiku wako wa kulia, asubuhi bado inakuja."),
    ('Psalms', 31, 24): (
        "Hope in God is what makes courage possible.",
        "Tumaini kwa Mungu ndilo linalowezesha ujasiri."),
    ('Psalms', 32, 8): (
        "Before deciding today, pause and ask for His guidance.",
        "Kabla ya kuamua jambo leo, tulia na umwombe akuongoze."),
    ('Psalms', 34, 8): (
        "Faith grows by experience: look for God's goodness in small things today.",
        "Imani hukua kwa uzoefu: tafuta wema wa Mungu katika mambo madogo leo."),
    ('Psalms', 34, 17): (
        "Your cry is heard, even when the answer has not come yet.",
        "Kilio chako kinasikika, hata kama jibu bado halijafika."),
    ('Psalms', 34, 18): (
        "If your heart is broken, God is not far away; He is close.",
        "Ikiwa moyo wako umevunjika, Mungu hayuko mbali; yu karibu."),
    ('Psalms', 37, 4): (
        "As we delight in God, our desires slowly become His.",
        "Tunapojifurahisha katika Mungu, tamaa zetu hugeuka polepole kuwa zake."),
    ('Psalms', 37, 5): (
        "Hand today's plans to Him, and trust Him with how they turn out.",
        "Mkabidhi mipango ya leo, na umwamini kwa jinsi itakavyokwenda."),
    ('Psalms', 37, 23): (
        "Even ordinary steps today can be ordered by the Lord.",
        "Hata hatua za kawaida leo zinaweza kuongozwa na Bwana."),
    ('Psalms', 40, 1): (
        "Patience in prayer is not silence from God; He bends down to listen.",
        "Subira katika maombi si ukimya wa Mungu; Yeye huinama kusikiliza."),
    ('Psalms', 42, 11): (
        "Speak hope to your own soul today, as the psalmist did.",
        "Iambie nafsi yako maneno ya tumaini leo, kama mtunga zaburi alivyofanya."),
    ('Psalms', 46, 1): (
        "Help is not far off; God is present in the trouble itself.",
        "Msaada hauko mbali; Mungu yupo ndani ya taabu yenyewe."),
    ('Psalms', 46, 10): (
        "Take one quiet minute today to simply be still before God.",
        "Chukua dakika moja ya utulivu leo, utulie tu mbele za Mungu."),
    ('Psalms', 51, 10): (
        "A clean heart is something God creates; ask Him for it today.",
        "Moyo safi ni kitu ambacho Mungu huumba; mwombe akupe leo."),
    ('Psalms', 55, 22): (
        "What burden could you hand over to Him this morning?",
        "Ni mzigo gani unaoweza kumkabidhi asubuhi hii?"),
    ('Psalms', 56, 3): (
        "Fear may come, but it does not have to have the last word.",
        "Hofu inaweza kuja, lakini si lazima iwe na neno la mwisho."),
    ('Psalms', 62, 1): (
        "Rest your soul in God before you rush into the day.",
        "Ipumzishe nafsi yako kwa Mungu kabla ya kukimbilia shughuli za siku."),
    ('Psalms', 63, 1): (
        "Bring your thirst to God first, before anything else tries to fill it.",
        "Mletee Mungu kiu yako kwanza, kabla kitu kingine hakijajaribu kuikata."),
    ('Psalms', 71, 14): (
        "Hope is a choice we can make again every morning.",
        "Tumaini ni uamuzi tunaoweza kufanya upya kila asubuhi."),
    ('Psalms', 73, 26): (
        "When your own strength runs out, God is still your portion.",
        "Nguvu zako zikiisha, Mungu bado ni fungu lako."),
    ('Psalms', 84, 11): (
        "Walk uprightly today, and trust Him with what is good for you.",
        "Enenda kwa unyoofu leo, na umwamini kwa kile kilicho chema kwako."),
    ('Psalms', 86, 15): (
        "God's patience with you is the pattern for your patience with others.",
        "Uvumilivu wa Mungu kwako ndio kielelezo cha uvumilivu wako kwa wengine."),
    ('Psalms', 91, 1): (
        "Make time today to dwell, not just visit, in God's presence.",
        "Tenga muda leo wa kukaa, si kutembelea tu, uweponi mwa Mungu."),
    ('Psalms', 91, 2): (
        "Say it aloud today: the Lord is my refuge, and I trust Him.",
        "Litamke kwa sauti leo: Bwana ni kimbilio langu, nami namtumaini."),
    ('Psalms', 91, 11): (
        "You are watched over in ways you will never see.",
        "Unalindwa kwa njia ambazo hutaziona kamwe."),
    ('Psalms', 94, 19): (
        "When thoughts crowd in, let God's comfort have the loudest voice.",
        "Mawazo yakikusonga, acha faraja ya Mungu iwe sauti kuu zaidi."),
    ('Psalms', 100, 4): (
        "Begin your prayer with thanks today, before any request.",
        "Anza maombi yako kwa shukrani leo, kabla ya ombi lolote."),
    ('Psalms', 103, 2): (
        "Remembering what God has done is fuel for trusting what He will do.",
        "Kukumbuka Mungu alichofanya ni nguvu ya kuamini atakachofanya."),
    ('Psalms', 103, 8): (
        "God is slower to anger than we are; let that shape how you respond today.",
        "Mungu si mwepesi wa hasira kama sisi; hilo liongoze jinsi utakavyojibu leo."),
    ('Psalms', 107, 1): (
        "His mercy has not run out overnight; it is still here this morning.",
        "Fadhili zake hazijaisha usiku; bado zipo asubuhi hii."),
    ('Psalms', 118, 24): (
        "Receive today as a gift that God has made, not just another day.",
        "Ipokee leo kama zawadi aliyoifanya Mungu, si siku nyingine tu."),
    ('Psalms', 119, 105): (
        "God's word may light only the next step, and that is enough.",
        "Neno la Mungu linaweza kuangaza hatua inayofuata tu, na hiyo inatosha."),
    ('Psalms', 121, 1): (
        "Where do you look first when you need help?",
        "Unatazama wapi kwanza unapohitaji msaada?"),
    ('Psalms', 121, 2): (
        "The One who made heaven and earth is not overwhelmed by your problem.",
        "Yeye aliyeziumba mbingu na nchi hazidiwi na tatizo lako."),
    ('Psalms', 121, 8): (
        "Your going out and coming in today are both in His keeping.",
        "Kutoka kwako na kuingia kwako leo vyote viko katika ulinzi wake."),
    ('Psalms', 126, 5): (
        "Tears sown in faith are not lost; a harvest of joy is coming.",
        "Machozi yaliyopandwa kwa imani hayapotei; mavuno ya furaha yanakuja."),
    ('Psalms', 127, 1): (
        "Invite God into your work and your home before you build anything else.",
        "Mkaribishe Mungu katika kazi yako na nyumba yako kabla ya kujenga kingine."),
    ('Psalms', 133, 1): (
        "Is there someone you could make peace with today?",
        "Je, kuna mtu unayeweza kupatana naye leo?"),
    ('Psalms', 138, 8): (
        "God finishes what He starts, including His work in you.",
        "Mungu humaliza alichoanza, ikiwemo kazi yake ndani yako."),
    ('Psalms', 139, 14): (
        "You were made with care; speak kindly to yourself today.",
        "Uliumbwa kwa uangalifu; jisemee maneno ya upole leo."),
    ('Psalms', 143, 8): (
        "Ask this morning to hear His love before you hear anything else.",
        "Omba asubuhi hii usikie upendo wake kabla ya kusikia kitu kingine."),
    ('Psalms', 145, 18): (
        "God is near to everyone who calls on Him honestly, so call.",
        "Mungu yu karibu na wote wanaomwita kwa kweli, kwa hiyo mwite."),
    ('Psalms', 147, 3): (
        "Bring God the wound you have hidden; He knows how to heal.",
        "Mletee Mungu jeraha ulilolificha; Yeye anajua kuponya."),
    ('Psalms', 150, 6): (
        "If you have breath this morning, you have a reason to praise.",
        "Ikiwa una pumzi asubuhi hii, una sababu ya kusifu."),
    ('Proverbs', 3, 5): (
        "Where are you leaning on your own understanding today?",
        "Ni wapi unategemea akili zako mwenyewe leo?"),
    ('Proverbs', 3, 6): (
        "Acknowledge Him in the small decisions, and trust Him with the path.",
        "Mkiri katika maamuzi madogo, na umwamini kwa njia yako."),
    ('Proverbs', 4, 23): (
        "Guard what you let into your heart today; life flows from it.",
        "Linda kile unachokiruhusu kuingia moyoni leo; uzima hutoka humo."),
    ('Proverbs', 11, 25): (
        "Refresh someone else today, and you will find yourself refreshed.",
        "Mburudishe mtu mwingine leo, nawe utajikuta umeburudishwa."),
    ('Proverbs', 15, 1): (
        "In one tense moment today, try answering gently.",
        "Katika wakati mmoja wa mvutano leo, jaribu kujibu kwa upole."),
    ('Proverbs', 16, 3): (
        "Commit your work to the Lord before you begin it.",
        "Mkabidhi Bwana kazi yako kabla ya kuianza."),
    ('Proverbs', 16, 9): (
        "Make your plans, and hold them with an open hand.",
        "Panga mipango yako, lakini ishike kwa mkono ulio wazi."),
    ('Proverbs', 16, 24): (
        "Say one kind, specific word to someone today.",
        "Mwambie mtu neno moja la wema, lililo mahususi, leo."),
    ('Proverbs', 17, 17): (
        "Who needs a faithful friend right now? Be that friend.",
        "Ni nani anahitaji rafiki mwaminifu sasa hivi? Kuwa rafiki huyo."),
    ('Proverbs', 18, 10): (
        "His name is a place to run to, not just a word to say.",
        "Jina lake ni mahali pa kukimbilia, si neno la kutamka tu."),
    ('Proverbs', 19, 21): (
        "Plans change; God's purpose stands. Rest in that.",
        "Mipango hubadilika; kusudi la Mungu hudumu. Pumzika katika hilo."),
    ('Proverbs', 22, 6): (
        "Pray today for a child whose path you have a part in shaping.",
        "Muombee leo mtoto ambaye una sehemu katika kuunda njia yake."),
    ('Proverbs', 27, 17): (
        "Whose faith sharpens yours, and whose could you encourage?",
        "Ni imani ya nani inaiimarisha yako, na ni nani unayeweza kumtia moyo?"),
    ('Proverbs', 31, 25): (
        "Strength and dignity are clothing God gives; wear them with confidence.",
        "Nguvu na heshima ni vazi analotoa Mungu; livae kwa ujasiri."),
    ('Ecclesiastes', 3, 1): (
        "Whatever season you are in, God is at work within it.",
        "Katika majira yoyote uliyomo, Mungu anatenda ndani yake."),
    ('Ecclesiastes', 4, 9): (
        "We were not made to walk alone; reach out to someone today.",
        "Hatukuumbwa kutembea peke yetu; mfikie mtu leo."),
    ('Ecclesiastes', 4, 12): (
        "A friendship with God at its centre holds when others would break.",
        "Urafiki ambao Mungu yuko katikati yake hudumu pale ambapo mingine ingekatika."),
    ('Isaiah', 26, 3): (
        "Where your mind rests today will shape how much peace you carry.",
        "Mahali akili yako inapopumzika leo kutaamua amani utakayobeba."),
    ('Isaiah', 30, 21): (
        "Listen today for the quiet voice that says, this is the way.",
        "Sikiliza leo ile sauti tulivu isemayo, njia ndiyo hii."),
    ('Isaiah', 40, 29): (
        "Feeling weak is not disqualifying; it is where His strength begins.",
        "Kujihisi dhaifu hakukuondoi; ndipo nguvu zake zinapoanzia."),
    ('Isaiah', 40, 31): (
        "Waiting on the Lord renews what hurrying wears out.",
        "Kumngoja Bwana hufanya upya kile ambacho haraka huchakaza."),
    ('Isaiah', 41, 10): (
        "Read it slowly: I am with you, I will strengthen you, I will uphold you.",
        "Soma polepole: Mimi niko pamoja nawe, nitakutia nguvu, nitakushika."),
    ('Isaiah', 41, 13): (
        "Picture your hand held in His as you walk into today.",
        "Jione mkono wako ukiwa umeshikwa na wake unapoingia katika siku hii."),
    ('Isaiah', 43, 2): (
        "The waters and the fire are real, and so is His presence in them.",
        "Maji na moto ni halisi, na uwepo wake ndani yake ni halisi pia."),
    ('Isaiah', 43, 19): (
        "Look for the new thing God may be starting in your life.",
        "Tafuta jambo jipya ambalo Mungu huenda anaanzisha maishani mwako."),
    ('Isaiah', 54, 17): (
        "Your security rests in who God is, not in what others say of you.",
        "Usalama wako unategemea Mungu alivyo, si kile wengine wanachosema juu yako."),
    ('Isaiah', 55, 8): (
        "When you cannot understand His ways, you can still trust His heart.",
        "Usipoelewa njia zake, bado unaweza kuuamini moyo wake."),
    ('Isaiah', 58, 11): (
        "Even in a dry season, God can make you a spring for others.",
        "Hata wakati wa ukame, Mungu anaweza kukufanya chemchemi kwa wengine."),
    ('Isaiah', 61, 1): (
        "Who near you is broken-hearted and needs good news today?",
        "Ni nani karibu nawe aliyevunjika moyo anayehitaji habari njema leo?"),
    ('Jeremiah', 29, 11): (
        "Your future is in the hands of someone who means you good.",
        "Wakati wako ujao uko mikononi mwa Yeye anayekukusudia mema."),
    ('Jeremiah', 31, 3): (
        "You are loved with a love that began before you and will outlast you.",
        "Unapendwa kwa upendo ulioanza kabla yako na utakaodumu baada yako."),
    ('Jeremiah', 32, 27): (
        "Name what feels impossible, and hear Him ask: is anything too hard for Me?",
        "Taja kinachoonekana hakiwezekani, umsikie akiuliza: kuna neno gumu kwangu?"),
    ('Jeremiah', 33, 3): (
        "Call on Him today; He answers, often beyond what you expect.",
        "Mwite leo; Yeye hujibu, mara nyingi kupita unavyotarajia."),
    ('Lamentations', 3, 22): (
        "You are still here, held by mercies that have not failed.",
        "Bado uko hapa, umeshikwa na rehema ambazo hazijakoma."),
    ('Lamentations', 3, 23): (
        "Yesterday is done; His mercy this morning is brand new.",
        "Jana imepita; rehema zake asubuhi hii ni mpya kabisa."),
    ('Lamentations', 3, 25): (
        "Seeking God is never time wasted; He is good to those who wait.",
        "Kumtafuta Mungu si kupoteza muda kamwe; Yeye ni mwema kwa wanaomngoja."),
    ('Micah', 6, 8): (
        "Justice, mercy and humility: which one can you practise today?",
        "Haki, rehema na unyenyekevu: ni kipi unachoweza kutenda leo?"),
    ('Habakkuk', 3, 19): (
        "God can steady your feet on the steepest path you face.",
        "Mungu anaweza kuziimarisha hatua zako katika njia yenye mwinuko mkali zaidi."),
    ('Zephaniah', 3, 17): (
        "Imagine it: God rejoices over you with singing.",
        "Fikiria hili: Mungu anakufurahia kwa kuimba."),
    ('Malachi', 3, 10): (
        "Faithfulness in giving opens us to the generosity of God.",
        "Uaminifu katika kutoa hutufungulia ukarimu wa Mungu."),
    ('Matthew', 5, 14): (
        "Your life is meant to be seen; let it point to Him.",
        "Maisha yako yamekusudiwa kuonekana; yaache yamwelekee Yeye."),
    ('Matthew', 5, 16): (
        "Do one good thing today that quietly points to your Father.",
        "Fanya jambo moja jema leo linalomwelekea Baba yako kwa utulivu."),
    ('Matthew', 6, 33): (
        "Put His kingdom first on today's list, and trust Him with the rest.",
        "Weka ufalme wake kwanza katika orodha ya leo, na umwamini kwa mengine."),
    ('Matthew', 6, 34): (
        "Carry today's load only; tomorrow has its own grace.",
        "Beba mzigo wa leo tu; kesho ina neema yake."),
    ('Matthew', 7, 7): (
        "Keep asking, keep seeking, keep knocking: persistence is part of prayer.",
        "Endelea kuomba, kutafuta na kubisha: kudumu ni sehemu ya maombi."),
    ('Matthew', 11, 28): (
        "If you are tired, this invitation is for you: come and rest.",
        "Ikiwa umechoka, mwaliko huu ni wako: njoo upumzike."),
    ('Matthew', 11, 29): (
        "Learn from His gentleness, and find rest for your soul.",
        "Jifunze upole wake, nawe utapata raha nafsini mwako."),
    ('Matthew', 17, 20): (
        "Small faith in a great God can move what seems immovable.",
        "Imani ndogo kwa Mungu mkuu inaweza kuondoa kisichoonekana kuondoka."),
    ('Matthew', 19, 26): (
        "What is impossible for you is not impossible for Him.",
        "Kisichowezekana kwako kinawezekana kwake."),
    ('Matthew', 28, 20): (
        "Always means today too, and every day after.",
        "Siku zote maana yake ni leo pia, na kila siku baadaye."),
    ('Mark', 9, 23): (
        "If your faith feels weak, pray honestly: help my unbelief.",
        "Ikiwa imani yako inaonekana dhaifu, omba kwa ukweli: nisaidie kutoamini kwangu."),
    ('Mark', 10, 27): (
        "Bring God the situation you have given up on.",
        "Mletee Mungu jambo ambalo umekata tamaa nalo."),
    ('Mark', 11, 24): (
        "Pray with expectation, trusting His wisdom in how He answers.",
        "Omba kwa matarajio, ukiamini hekima yake katika jinsi anavyojibu."),
    ('Luke', 1, 37): (
        "No word from God is without power.",
        "Hakuna neno kutoka kwa Mungu lisilo na nguvu."),
    ('Luke', 6, 31): (
        "Treat someone today the way you hope to be treated.",
        "Mtendee mtu leo kama unavyotumaini kutendewa."),
    ('Luke', 6, 38): (
        "Give generously today, of your time as well as your things.",
        "Toa kwa ukarimu leo, muda wako pamoja na mali yako."),
    ('Luke', 12, 7): (
        "God knows you in detail, and you are of great worth to Him.",
        "Mungu anakujua kwa undani, nawe una thamani kubwa kwake."),
    ('John', 1, 5): (
        "No darkness you face today is stronger than His light.",
        "Hakuna giza unalokabili leo lililo na nguvu kuliko nuru yake."),
    ('John', 3, 16): (
        "Read it again with your own name in place of the world.",
        "Isome tena ukiweka jina lako mahali pa ulimwengu."),
    ('John', 8, 12): (
        "Follow Him closely today, and you will not walk in darkness.",
        "Mfuate kwa karibu leo, nawe hutatembea gizani."),
    ('John', 14, 1): (
        "A troubled heart can choose to trust, one moment at a time.",
        "Moyo uliofadhaika unaweza kuchagua kuamini, wakati mmoja baada ya mwingine."),
    ('John', 14, 6): (
        "Jesus is not only the way to the Father; He walks it with you.",
        "Yesu si njia ya kwenda kwa Baba tu; Yeye anaitembea pamoja nawe."),
    ('John', 14, 27): (
        "His peace does not depend on everything going right.",
        "Amani yake haitegemei kila jambo kwenda sawa."),
    ('John', 15, 5): (
        "Stay close to Him today; fruit grows from connection, not effort alone.",
        "Kaa karibu naye leo; matunda hukua kwa kuunganika naye, si kwa juhudi pekee."),
    ('John', 16, 33): (
        "Trouble is real, but so is the One who has overcome the world.",
        "Dhiki ni halisi, lakini Yeye aliyeushinda ulimwengu ni halisi pia."),
    ('Romans', 5, 3): (
        "Hard things are not wasted; God uses them to grow patience in us.",
        "Mambo magumu hayapotei bure; Mungu huyatumia kukuza saburi ndani yetu."),
    ('Romans', 8, 18): (
        "Today's struggle is real, but it is not the end of your story.",
        "Mapambano ya leo ni halisi, lakini si mwisho wa hadithi yako."),
    ('Romans', 8, 28): (
        "Not everything is good, but God can work all things toward good.",
        "Si kila jambo ni jema, lakini Mungu anaweza kufanya yote yafanye kazi kwa wema."),
    ('Romans', 8, 31): (
        "If God is for you, no opposition gets the final say.",
        "Ikiwa Mungu yuko upande wako, hakuna upinzani wenye neno la mwisho."),
    ('Romans', 8, 38): (
        "Nothing you face today can separate you from God's love.",
        "Hakuna unachokabili leo kinachoweza kukutenga na upendo wa Mungu."),
    ('Romans', 12, 2): (
        "Let God renew your thinking in one area of your life today.",
        "Mwache Mungu afanye upya fikra zako katika eneo moja la maisha yako leo."),
    ('Romans', 12, 12): (
        "Hope, patience and prayer: hold on to all three today.",
        "Tumaini, saburi na maombi: shikilia yote matatu leo."),
    ('Romans', 15, 13): (
        "Ask God to fill you with hope until it overflows to others.",
        "Mwombe Mungu akujaze tumaini hadi lifurike kwa wengine."),
    ('1 Corinthians', 10, 13): (
        "In every temptation today, look for the way out God provides.",
        "Katika kila jaribu leo, tafuta mlango wa kutokea ambao Mungu hutoa."),
    ('1 Corinthians', 13, 4): (
        "Choose one of love's qualities to practise on purpose today.",
        "Chagua sifa moja ya upendo uitende kwa makusudi leo."),
    ('1 Corinthians', 13, 13): (
        "Of all you do today, let love be the greatest part.",
        "Kati ya yote utakayofanya leo, upendo uwe sehemu kuu zaidi."),
    ('1 Corinthians', 15, 58): (
        "Your faithful work for the Lord is never in vain, even when unseen.",
        "Kazi yako ya uaminifu kwa Bwana si bure kamwe, hata isipoonekana."),
    ('1 Corinthians', 16, 13): (
        "Stand firm today; strength in faith is built one choice at a time.",
        "Simama imara leo; nguvu katika imani hujengwa kwa uamuzi mmoja baada ya mwingine."),
    ('1 Corinthians', 16, 14): (
        "Whatever you do today, let love be the reason and the way.",
        "Lolote utakalofanya leo, upendo uwe sababu na njia."),
    ('2 Corinthians', 1, 3): (
        "The comfort you receive from God is meant to be passed on.",
        "Faraja unayopokea kutoka kwa Mungu imekusudiwa kupitishwa kwa wengine."),
    ('2 Corinthians', 4, 16): (
        "Even when you feel worn out, God is renewing you inside, day by day.",
        "Hata unapojihisi umechoka, Mungu anakufanya upya ndani, siku kwa siku."),
    ('2 Corinthians', 4, 18): (
        "Lift your eyes today from what is passing to what lasts.",
        "Inua macho yako leo kutoka kwa yanayopita hadi kwa yanayodumu."),
    ('2 Corinthians', 5, 7): (
        "When you cannot see the way, you can still walk by faith.",
        "Usipoiona njia, bado unaweza kutembea kwa imani."),
    ('2 Corinthians', 5, 17): (
        "In Christ your past does not define you; you are new.",
        "Katika Kristo mambo yako ya zamani hayakufafanui; wewe ni mpya."),
    ('2 Corinthians', 9, 8): (
        "God gives enough grace for every good work He puts before you.",
        "Mungu hutoa neema ya kutosha kwa kila kazi njema anayokuwekea mbele."),
    ('2 Corinthians', 12, 9): (
        "Your weakness is where His strength shows most clearly.",
        "Udhaifu wako ndipo nguvu zake zinapoonekana wazi zaidi."),
    ('Galatians', 5, 22): (
        "Which fruit of the Spirit do you most need to grow this week?",
        "Ni tunda lipi la Roho unalohitaji kukua zaidi wiki hii?"),
    ('Galatians', 6, 9): (
        "Keep doing good, even when it seems unnoticed; the harvest will come.",
        "Endelea kutenda mema, hata yasipoonekana; mavuno yatakuja."),
    ('Ephesians', 2, 8): (
        "Salvation is a gift to receive with thanks, not a wage to earn.",
        "Wokovu ni zawadi ya kupokea kwa shukrani, si mshahara wa kufanyia kazi."),
    ('Ephesians', 3, 20): (
        "Pray big today; God can do more than you can ask or imagine.",
        "Omba mambo makubwa leo; Mungu anaweza kufanya zaidi ya unavyoomba au kuwaza."),
    ('Ephesians', 4, 32): (
        "Is there someone you need to forgive, as you have been forgiven?",
        "Je, kuna mtu unayehitaji kumsamehe, kama ulivyosamehewa?"),
    ('Ephesians', 6, 10): (
        "Draw your strength from the Lord today, not from yourself alone.",
        "Chota nguvu zako kwa Bwana leo, si kwako mwenyewe pekee."),
    ('Philippians', 1, 6): (
        "God is not finished with you, and He will not give up on you.",
        "Mungu hajamaliza kazi yake ndani yako, na hatakuacha."),
    ('Philippians', 2, 3): (
        "Look for a way to put someone else first today.",
        "Tafuta njia ya kumtanguliza mtu mwingine leo."),
    ('Philippians', 3, 13): (
        "Let go of what is behind; God is calling you forward.",
        "Achilia yaliyo nyuma; Mungu anakuita usonge mbele."),
    ('Philippians', 4, 4): (
        "Find one reason to rejoice in the Lord before noon.",
        "Tafuta sababu moja ya kufurahi katika Bwana kabla ya adhuhuri."),
    ('Philippians', 4, 6): (
        "Turn one worry into a prayer, with thanksgiving.",
        "Geuza wasiwasi mmoja kuwa ombi, pamoja na shukrani."),
    ('Philippians', 4, 7): (
        "His peace can guard your heart even when you cannot explain it.",
        "Amani yake inaweza kulinda moyo wako hata usipoweza kuieleza."),
    ('Philippians', 4, 8): (
        "Choose carefully what you dwell on today.",
        "Chagua kwa makini mambo utakayoyatafakari leo."),
    ('Philippians', 4, 13): (
        "Whatever today asks of you, Christ gives the strength to meet it.",
        "Lolote siku hii itakalodai kwako, Kristo hutoa nguvu ya kulitimiza."),
    ('Philippians', 4, 19): (
        "Trust God with your needs today; His supply does not run short.",
        "Mwamini Mungu kwa mahitaji yako leo; riziki yake haipungui."),
    ('Colossians', 3, 2): (
        "Set your heart on what lasts, and hold earthly things lightly.",
        "Weka moyo wako kwa yanayodumu, na ushike mambo ya dunia kwa wepesi."),
    ('Colossians', 3, 15): (
        "Let His peace decide between your choices today, and be thankful.",
        "Acha amani yake iamue kati ya chaguo zako leo, na uwe na shukrani."),
    ('Colossians', 3, 23): (
        "Do today's work as an offering to the Lord.",
        "Fanya kazi ya leo kama sadaka kwa Bwana."),
    ('1 Thessalonians', 5, 11): (
        "Send someone an encouraging word today.",
        "Mtumie mtu neno la kutia moyo leo."),
    ('1 Thessalonians', 5, 16): (
        "Joy is possible today, not because all is easy, but because God is near.",
        "Furaha inawezekana leo, si kwa sababu yote ni rahisi, bali kwa sababu Mungu yu karibu."),
    ('1 Thessalonians', 5, 18): (
        "In every situation today, look for something to thank God for.",
        "Katika kila hali leo, tafuta jambo la kumshukuru Mungu."),
    ('2 Timothy', 1, 7): (
        "Fear is not from God; ask Him for power, love and a sound mind.",
        "Hofu haitoki kwa Mungu; mwombe nguvu, upendo na moyo wa kiasi."),
    ('2 Timothy', 3, 16): (
        "Let Scripture teach and shape you today, not just inform you.",
        "Acha Maandiko yakufundishe na kukuunda leo, si kukupa habari tu."),
    ('Titus', 2, 11): (
        "Grace has appeared for everyone, including the person you find hardest.",
        "Neema imewafunukia watu wote, hata yule unayemwona mgumu zaidi."),
    ('Hebrews', 4, 16): (
        "You are welcome at God's throne; come with confidence.",
        "Unakaribishwa kwenye kiti cha enzi cha Mungu; njoo kwa ujasiri."),
    ('Hebrews', 10, 23): (
        "Hold on to hope; the One who promised is faithful.",
        "Shikilia tumaini; Yeye aliyeahidi ni mwaminifu."),
    ('Hebrews', 11, 1): (
        "Faith trusts what God has said before we see it happen.",
        "Imani huamini kile Mungu alichosema kabla hatujaona kikitokea."),
    ('Hebrews', 12, 1): (
        "What weight could you lay aside to run more freely?",
        "Ni mzigo gani unaoweza kuweka kando ili ukimbie kwa uhuru zaidi?"),
    ('Hebrews', 12, 2): (
        "Keep your eyes on Jesus; He began your faith and will complete it.",
        "Mkazie Yesu macho; Yeye ndiye mwanzilishi wa imani yako na atakayeikamilisha."),
    ('Hebrews', 13, 5): (
        "Contentment grows from knowing He will never leave you.",
        "Kuridhika hukua kutokana na kujua kwamba hatakuacha kamwe."),
    ('Hebrews', 13, 8): (
        "In a changing world, Jesus is the same today as yesterday.",
        "Katika ulimwengu unaobadilika, Yesu ni yeye yule leo kama jana."),
    ('James', 1, 2): (
        "Trials can grow what comfort never could.",
        "Majaribu yanaweza kukuza kile ambacho starehe haiwezi."),
    ('James', 1, 5): (
        "Facing a decision? Ask God for wisdom; He gives it generously.",
        "Unakabiliwa na uamuzi? Mwombe Mungu hekima; Yeye huitoa kwa ukarimu."),
    ('James', 1, 12): (
        "Holding on through testing is never wasted in God's eyes.",
        "Kustahimili katika majaribu si bure kamwe machoni pa Mungu."),
    ('James', 1, 17): (
        "Trace one good gift in your life back to the Father of lights.",
        "Fuatilia zawadi moja njema maishani mwako hadi kwa Baba wa mianga."),
    ('James', 4, 8): (
        "Take one step toward God today; He is already coming toward you.",
        "Piga hatua moja kumkaribia Mungu leo; Yeye tayari anakukaribia."),
    ('1 Peter', 4, 10): (
        "Use the gift God gave you to serve someone today.",
        "Tumia karama aliyokupa Mungu kumtumikia mtu leo."),
    ('1 Peter', 5, 6): (
        "Humility is trusting God's timing for lifting you up.",
        "Unyenyekevu ni kuamini wakati wa Mungu wa kukuinua."),
    ('1 Peter', 5, 7): (
        "Cast your care on Him, because He truly cares for you.",
        "Mtwike fadhaa yako, kwa sababu kweli anajishughulisha nawe."),
    ('2 Peter', 3, 9): (
        "God's patience is His mercy, giving time for every heart to return.",
        "Uvumilivu wa Mungu ni rehema yake, akitoa muda kwa kila moyo kurudi."),
    ('1 John', 1, 9): (
        "Confession is not the end of hope; it is the door to cleansing.",
        "Kukiri si mwisho wa tumaini; ni mlango wa kutakaswa."),
    ('1 John', 3, 1): (
        "You are called a child of God. Let that settle in.",
        "Unaitwa mtoto wa Mungu. Acha hilo likae moyoni mwako."),
    ('1 John', 4, 18): (
        "The more you know His love, the less room fear has.",
        "Kadiri unavyoujua upendo wake, ndivyo hofu inavyokosa nafasi."),
    ('1 John', 4, 19): (
        "Our love for God is always an answer to His love first.",
        "Upendo wetu kwa Mungu daima ni jibu kwa upendo wake uliotangulia."),
    ('1 John', 5, 14): (
        "Pray with confidence; God hears every prayer that seeks His will.",
        "Omba kwa uhakika; Mungu husikia kila ombi linalotafuta mapenzi yake."),
    ('Revelation', 21, 4): (
        "Every tear has an end date; hold on to that promise today.",
        "Kila chozi lina mwisho wake; shikilia ahadi hiyo leo."),
}


def reflection_for(book, chapter, verse):
    """{'en': ..., 'sw': ...} for a curated verse, or None."""
    pair = REFLECTIONS.get((book, chapter, verse))
    return {'en': pair[0], 'sw': pair[1]} if pair else None
