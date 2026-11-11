// Four letters: the landing page hero's second pane makes four-letter words in Trapu Tall, coined only (anything
// in the dictionary is thrown back), built from the Gazetteer's phoneme grammar (dialect "core"). The same grammar
// as jontoews.com/four-letters/.
(() => {

/* ---- the Gazetteer's PRNG and seed hash, unchanged ---- */
const MASK64 = (1n << 64n) - 1n;
function splitmix64(state) {
  state = (state + 0x9E3779B97F4A7C15n) & MASK64;
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & MASK64;
  z = z ^ (z >> 31n);
  return [z & MASK64, state];
}
class Rng {
  constructor(seed) { this.state = seed & MASK64; }
  next_u64() { const [v, s] = splitmix64(this.state); this.state = s; return v; }
  below(n) { return Number(this.next_u64() % BigInt(n)); }
  unit() { return Number(this.next_u64() >> 11n) / 9007199254740992; }
  pick(seq) { return seq[this.below(seq.length)]; }
  weighted(items, weights) {
    let total = 0; for (const w of weights) total += w;
    const r = this.below(total);
    let acc = 0;
    for (let i = 0; i < items.length; i++) { acc += weights[i]; if (r < acc) return items[i]; }
    return items[items.length - 1];
  }
}
function mix64(h, v) {
  h ^= v & MASK64;
  h = (h * 0x100000001B3n) & MASK64;
  h ^= h >> 33n;
  h = (h * 0xFF51AFD7ED558CCDn) & MASK64;
  h ^= h >> 29n;
  return h & MASK64;
}
function hash_seed(value) {
  let h = 0xCBF29CE484222325n;
  for (const ch of "four:" + String(value)) h = mix64(h, BigInt(ch.codePointAt(0)));
  return h || 0x1234567890ABCDEFn;
}

/* ---- dialect "core", as in the Gazetteer ---- */
const D = {
  nuclei: ["a","e","i","o","u","y","ae","ei","ou","ia","au"],
  nuclei_w: [16,15,14,13,8,4,3,3,2,2,2],
  simple_onsets: [..."bdfgklmnprstvz","th","sh","ch"],
  cluster_onsets: ["br","dr","fr","gr","kr","pr","tr","bl","fl","gl","kl","pl","sl","st","sk","sp","sn","sm","thr","vr"],
  codas: ["n","r","s","l","t","k","m","th","nd","rn","st","ll","ss"],
  codas_w: [12,12,8,8,6,4,4,3,3,2,2,2,2],
};
/* Consonant contact across a syllable break: which onsets may follow a coda. */
const JOIN = {
  l: ["b","d","f","g","k","m","p","s","t","v","th"],
  r: ["b","d","f","g","k","l","m","n","p","s","t","v","z","th","ch","sh"],
  n: ["d","t","k","g","s","z","th","ch","sh"],
  m: ["b","p"],
  s: ["t","k","p","m","n","l"],
  t: ["r","l","s"], k: ["r","l","s","t"], th: ["r","l"], d: ["r"],
};
const MEDIAL_CODAS = Object.keys(JOIN);
const MEDIAL_W = { l:8, r:9, n:9, m:4, s:6, t:3, k:3, th:1, d:1 };
const ALL_ONSETS = [...D.cluster_onsets, ...D.simple_onsets].sort((a, b) => b.length - a.length);
const ALL_NUCLEI = [...D.nuclei].sort((a, b) => b.length - a.length);

// the 1934 Webster four-letter words this grammar can spell, plus the ones macOS's current English spell checker
// knows (modern words, abbreviations, and the profanity a homepage must never coin)
const LEXICON = new Set(["abae","abas","abet","abir","able","ably","abut","ache","achy","adae","adar","adat","adel","adet","adit","adry","aeba","aebe","aeda","aede","aefa","aefe","aero","aery","afae","afar","agal","agar","agen","ager","ages","agin","agla","agon","agre","akan","akia","akin","akra","alan","alar","alas","alba","albe","alem","alen","ales","alfa","alga","algo","alia","alin","alit","alky","alma","alme","alpa","alpo","also","alto","alum","amar","amba","ambo","amen","amil","amin","amir","amok","amor","amyl","anal","anam","anan","anar","anat","anda","anes","ango","angu","anil","anis","anon","ansa","ansi","ansu","anta","ante","anti","antu","anus","apar","aper","apes","apia","apis","arak","aran","arar","arba","ardu","aren","ares","argo","argy","aria","aril","army","arna","arni","aros","arse","arty","arum","aryl","asak","asem","ashy","asme","asok","asor","asta","ates","atet","atis","atle","atom","atry","aube","auge","aula","aulu","aune","aura","ausu","aute","auth","auto","aval","aver","aves","azon","baba","babe","babu","baby","bada","bade","baes","bafa","bafe","baga","bago","baka","bake","baku","bale","bali","ball","balu","bama","band","bane","bani","bara","bare","bari","barn","baru","base","bass","bast","bata","bate","bath","baul","baun","baze","beba","bebe","beda","bede","befa","befe","bego","bela","bell","bely","bema","bena","bend","bene","beni","beno","bere","beri","bern","besa","bess","best","beta","beth","beti","bevy","bias","bibi","bide","bidi","biga","bike","bile","bill","bilo","bind","bine","bino","biri","birn","biro","bite","biti","bito","blae","blan","blas","blat","blet","blin","blot","blur","boba","bobo","bode","body","boga","bogo","bogy","boke","boku","bola","bole","boll","bolo","boma","bona","bond","bone","bono","bony","bora","bore","born","boro","bose","boss","bota","bote","both","bouk","boun","bout","boza","bozo","brae","bran","bras","brat","brei","bret","brim","brin","bris","brit","bros","brot","brut","buba","bubo","buda","bufo","bull","buna","bund","bure","buri","burn","buro","bury","buss","bust","busy","bygo","byre","byte","byth","chal","cham","chan","char","chat","chem","chia","chil","chin","chis","chit","chol","chum","chun","chut","daba","dabe","dada","dade","dadi","dado","daer","dafa","dafe","dale","dali","daly","dama","dame","dana","dand","dane","dare","dari","darn","dasi","data","date","daut","dave","davy","daze","dazy","deba","debe","deda","dede","dedo","defa","defe","defy","degu","deka","deke","dele","deli","dell","deme","demi","demo","demy","dene","deny","depa","depo","dere","dern","desi","dess","dest","deva","dial","dian","didi","dido","dika","dike","diku","dili","dill","dilo","dime","dimi","dine","dire","diss","dita","dite","diva","dive","divi","divo","dobe","doby","dodo","doge","dogy","doke","dola","dole","doli","doll","dome","domy","done","dopa","dope","dopy","dora","dorn","dory","dosa","dose","doss","dost","dote","doth","doty","doum","dour","dout","dove","doze","dozy","dram","drat","drum","drys","dude","duke","dull","duly","duma","dune","duny","dupe","dura","dure","durn","duro","dust","duty","dyke","dyne","ebae","ebon","eche","echo","edae","edam","eden","edit","efae","egis","egol","egos","eire","eker","ekes","elan","elbe","elmy","else","emir","emit","emus","enam","enol","enos","ense","enum","epos","eral","eras","erat","ergo","eria","erne","eros","esne","espy","etas","etym","eval","even","ever","eves","evil","faba","fabe","fada","fade","fado","fady","faer","fafa","fafe","fage","fake","faky","fall","fame","fana","fand","fane","fare","faro","fass","fast","fate","faun","fava","fave","faze","feba","febe","feda","fede","fefa","fefe","feil","fein","feis","fell","feme","fend","feni","fern","feru","fess","fest","feta","fete","fiar","fiat","fide","fido","fife","fifo","fike","file","fill","filo","fina","find","fine","fino","fire","firn","fise","fist","five","flak","flam","flan","flat","flet","flit","flor","flot","flus","flys","fogo","fogy","fole","fomo","fond","fono","fora","fore","foto","foul","foun","four","fozy","frae","frat","fren","fret","frim","frit","from","fros","frot","fufu","fugu","fula","full","fume","fumy","fund","fury","fuse","fuss","fust","fute","fuze","fyke","gabi","gaby","gade","gaen","gaet","gaga","gage","gala","gale","gali","gall","game","gamy","gane","gapa","gape","gapo","gapy","gara","gare","garn","gast","gata","gate","gato","gaul","gaum","gaun","gaur","gaus","gaut","gave","gaze","gazi","gazy","gein","gell","gena","gene","genu","geri","gest","geta","giar","gibe","giga","gigo","gila","gill","gilo","gina","girn","giro","gist","gith","give","glam","glar","glen","glia","glom","glor","glum","glut","gobi","gobo","goby","gode","gogo","gola","goli","gone","gony","gora","gore","gory","gote","goth","goto","gout","gove","gram","gran","gras","grat","grim","grin","gris","grit","grok","gros","grot","grum","grun","gude","gufa","gugu","gula","gule","gull","gumi","guna","guru","guss","gust","guze","gybe","gyle","gyne","gyno","gype","gyre","gyri","gyro","gyte","gyve","iata","ibis","ichi","icho","ichu","idek","idem","ides","idil","idim","idol","idyl","ikat","ikon","ikra","ildi","ilia","ilil","ilim","ilka","ilmi","ilot","ilvi","imam","imbe","imil","imim","impi","impy","inde","indy","inga","inis","init","inky","inso","into","ipil","iras","ires","iris","irma","irok","iron","isis","isle","ismy","item","iter","ivar","ives","ivil","ivim","ivin","izar","izou","kago","kagu","kaka","kaki","kako","kala","kale","kali","kalo","kame","kana","kano","kapa","kara","karo","kasa","kata","kath","kati","kaum","kava","kazi","keko","kela","kele","kell","kend","keno","kepi","kere","keri","kern","keta","keto","kibe","kiby","kike","kiki","kiku","kill","kilo","kina","kind","kine","kino","kipe","kiri","kirn","kiss","kist","kite","kith","kiva","kivu","klam","klan","klom","kobi","kobo","kobu","koda","koko","koku","kola","kolo","kona","kopi","kora","kore","kori","koto","kozo","kral","kran","kras","kris","kuba","kudu","kuge","kuku","kula","kuna","kuru","kusa","kuso","kyle","kyte","lade","lady","laet","lake","laky","lall","lalo","lama","lame","land","lane","lari","lasa","lass","last","lata","late","lath","laun","laur","lava","lave","laze","lazy","leda","lede","lego","leis","lela","lena","lend","lene","leno","lepa","less","lest","lete","leva","levo","levy","liar","lidi","lido","life","lifo","like","lile","lili","lill","lily","lima","lime","limi","limo","limu","limy","lina","line","lino","liny","lipa","lira","lire","liss","list","lite","lith","live","livi","lobe","lobo","lode","loge","logo","logy","loka","loke","loll","loma","lone","lope","lora","lore","lori","lorn","loro","lory","lose","loss","lost","lota","lote","loth","loti","louk","lour","lout","love","luba","lube","ludo","luge","luke","lull","lulu","luma","luna","lune","luny","lupe","lura","lure","lust","lute","luva","lyle","lyra","lyre","lyse","mabi","made","mado","mage","magi","make","maki","mako","mala","male","mali","mall","malo","mama","mamo","mana","mand","mane","mani","mano","many","mapo","mara","mare","maro","maru","mary","masa","mass","mast","masu","mate","math","maty","maul","maun","maza","maze","mazy","mede","mega","mein","mela","mele","mell","meme","memo","mend","menu","meny","mere","mero","mesa","mese","meso","mess","meta","mete","meth","mian","mias","mide","midi","mike","mila","mile","mili","mill","milo","mima","mime","mimi","mina","mind","mine","mini","mino","miny","mire","miro","miry","mise","miso","miss","mist","mite","mity","mivi","mobi","mode","modi","modo","mogo","moke","moki","moko","moky","mola","mole","moll","moly","mome","momo","mona","mone","mono","mope","mora","more","morn","moro","moss","most","mote","moth","moto","moul","mout","move","muga","mule","mull","mund","muni","mura","mure","muse","muss","must","muta","mute","muth","myna","myra","myst","myth","nabe","nada","nael","naga","naka","nake","nako","name","nana","nane","nano","napa","nape","napu","nary","nasa","nasi","nast","nato","naus","naut","nave","navy","naze","nazi","nell","nema","nene","nese","ness","nest","nete","neth","neti","neve","nevi","nevo","nide","nidi","nife","nike","niko","nile","nine","nipa","nite","nito","nizy","node","nodi","noli","noll","nolo","noma","nome","nomo","nona","none","nope","nori","nose","nosy","nota","note","noun","nous","nova","novo","nude","nuke","null","numa","nyse","oban","obis","obit","obol","odal","odel","oden","oder","odes","odin","odor","odum","odyl","ogam","ogle","ogre","ogum","oket","okia","okra","olam","olde","oles","olin","olpe","omen","omer","omit","ondy","oner","ones","onto","onus","onym","onza","opal","open","opes","opus","oral","oran","orby","ordu","orem","oren","ores","orgy","orin","orle","orlo","orly","orna","orzo","osha","ouse","oust","outa","ouzo","oval","oven","over","ovum","paga","page","pale","pali","pall","palo","paly","pand","pane","pano","papa","pape","papi","para","pare","pari","pasi","pass","past","pata","pate","path","pati","pato","patu","paty","paut","pave","pavy","peba","peda","pedi","pedo","pega","pell","pelu","pend","pepo","peri","pern","pesa","peso","pess","pest","peta","pete","peto","pial","pian","pika","pike","piki","piky","pile","pili","pill","pily","pima","pina","pind","pine","pino","piny","pipa","pipe","pipi","pipy","pirn","pise","piso","piss","pist","pita","pith","pity","pize","plak","plan","plat","plim","plot","plum","plus","pogo","pogy","poke","poky","pole","poll","polo","poly","pome","pond","pone","pony","pope","pore","porn","pory","pose","poss","post","posy","pote","pour","pout","pram","prat","prau","prim","prom","pros","prut","pudu","puka","puke","puku","puky","pula","pule","puli","pull","pulu","puly","puma","puna","puny","pupa","pure","puri","puss","pyke","pyla","pyre","pyro","rabe","rada","raga","rage","rake","raki","raku","rale","rame","rami","rana","rand","rane","rani","rape","rare","rasa","rase","rata","rate","rath","rauk","raun","rave","raze","reba","rede","redo","refi","reim","rein","reis","reit","rely","rend","repo","rero","rest","reti","reve","rial","ribe","ride","rife","rile","rill","rima","rime","rimu","rimy","rind","rine","ripa","ripe","rise","rist","rita","rite","riva","rive","robe","rode","roka","roke","roky","role","roll","rona","rond","rone","rope","ropy","rory","rosa","rose","ross","rosy","rota","rote","roti","roto","roun","rout","rove","rube","ruby","rude","ruga","rule","rull","rune","rupa","ruru","ruse","russ","rust","ruth","ryme","rynd","rype","sabe","sade","sado","safe","safi","saga","sage","sago","sagy","sake","saki","sale","same","sand","sane","sapa","sapo","sare","sari","sasa","sase","sass","sate","sati","saum","saur","saut","save","sego","seis","seit","sele","sell","seme","semi","send","sene","sera","sere","seri","sero","sess","seta","seth","sham","shan","shat","shel","sher","shim","shin","shit","shor","shot","shou","shul","shun","shut","siak","sial","siam","side","sidi","sidy","sife","sika","sike","sile","sill","silo","sima","sime","sina","sind","sine","sipe","sire","sise","sisi","siss","sist","site","sith","situ","siva","size","sizy","skal","skas","skat","skel","sken","sker","skil","skim","skin","skis","skit","skun","slae","slam","slat","slim","slit","slon","slot","slum","slur","slut","smit","smur","smut","snit","snot","snum","snur","soba","soda","sody","sofa","soka","soke","sola","sole","soli","solo","soma","some","sond","sone","sope","sora","sore","sori","sorn","sory","soso","soss","souk","soul","soum","sour","sous","spae","spak","spam","span","spar","spas","spat","spet","spin","spit","spor","spot","spun","spur","sput","stam","star","stat","stem","sten","stet","stim","stir","stot","stum","stun","stut","sudo","sugi","sull","sulu","sumo","sune","supa","supe","sura","sure","susi","suss","susu","suva","suzy","syne","syre","tabu","tada","tade","tael","taen","take","taky","tala","tale","tali","tall","tame","tana","tane","tapa","tape","tapu","tara","tare","tari","tarn","taro","tase","tass","tasu","tate","tath","tatu","taum","taun","taur","taus","taut","tave","tegu","teil","tele","teli","tell","tend","tera","tern","test","tete","teth","than","thar","that","them","then","thin","thir","this","thon","thot","thou","thro","thus","tian","tiar","tias","tide","tidy","tige","tike","tiki","tile","till","time","tind","tine","tiny","tipe","tipi","tire","tiro","tite","titi","tivy","tiza","tobe","toby","tode","todo","tody","tofu","toga","togo","toke","toko","tole","toll","tolu","tome","tone","tony","tope","topi","topo","tora","tore","tori","torn","toro","toru","tory","tosa","toss","tost","tosy","tote","toto","toty","tour","tout","toze","tram","trek","tres","tret","trim","trin","tris","tron","trot","trun","tryt","tuba","tube","tufa","tuke","tula","tule","tume","tuna","tund","tune","tuno","tunu","tuny","turn","tusi","tute","tuth","tutu","tuza","tyke","tynd","tyne","type","typo","typy","tyre","tyro","uber","udal","udon","ufos","ugly","ulan","ulmo","ulus","umbo","umol","unal","unau","unde","undo","undy","unit","unto","unum","unze","upas","upla","upon","ural","uran","urde","urge","urna","urus","urva","usar","user","uses","usia","utas","util","utum","uval","uzan","uzis","vade","vady","vage","vagi","vale","vali","vall","vane","vape","vara","vare","vari","vary","vasa","vase","vast","vasu","veda","veil","vein","veir","vela","vell","velo","vena","vend","vera","veri","vern","very","vest","veta","veto","vial","vibe","vida","vide","vidi","viga","vila","vile","vili","vill","vimi","vina","vine","vino","viny","vire","visa","vise","vita","viva","vive","vivi","vivo","vole","vota","vote","vous","zane","zany","zati","zebu","zein","zemi","zend","zenu","zero","zest","zeta","zibo","zika","zine","zira","ziti","zobo","zogo","zoll","zone","zori","zouk","zuza","zyga","zyme"]);

/* Parse a word into syllables under the grammar (fewest syllables first). Used for anatomy and to vet every coinage. */
function parse(w) {
  const out = [];
  (function syl(i, acc, prev) {
    if (i === w.length && acc.length) { out.push(acc); return; }
    if (acc.length === 2) return;
    for (const on of ["", ...ALL_ONSETS]) {
      if (!w.startsWith(on, i)) continue;
      if (acc.length) {
        if (!on && !prev) continue;                                // no vowel-to-vowel hiatus
        if (prev && on && !(JOIN[prev] || []).includes(on)) continue;
      }
      const j = i + on.length;
      for (const nu of ALL_NUCLEI) {
        if (!w.startsWith(nu, j)) continue;
        const k = j + nu.length;
        if (k === w.length) { syl(k, [...acc, { on, nu, co: "" }], ""); continue; }
        for (const co of [...D.codas, ...MEDIAL_CODAS.filter(c => !D.codas.includes(c)), ""]) {
          if (co && !w.startsWith(co, k)) continue;
          const kk = k + co.length;
          if (co && kk !== w.length && !JOIN[co]) continue;
          if (co && kk === w.length && !D.codas.includes(co)) continue;
          syl(kk, [...acc, { on, nu, co }], co);
        }
      }
    }
  })(0, [], "");
  // fewest syllables first; then give later syllables their consonant (pu·re, not pur·e)
  const bare = (p) => p.slice(1).filter(s => !s.on).length;
  out.sort((a, b) => a.length - b.length || bare(a) - bare(b));
  return out[0] || null;
}

/* Coin one four-letter word: a one-syllable shape (CVCC, CCVC, CVVC, CCVV) or a two-syllable one (CVCV, VCCV, VCVC). */
function onset(rng, clusterP) {
  if (rng.unit() < clusterP) return rng.pick(D.cluster_onsets);
  return rng.pick(D.simple_onsets);
}
function coinOnce(rng) {
  const two = rng.unit() < 0.5;
  let w;
  if (!two) {
    const on = rng.unit() < 0.92 ? onset(rng, 0.4) : "";
    const nu = rng.weighted(D.nuclei, D.nuclei_w);
    const co = rng.weighted(D.codas, D.codas_w);
    w = on + nu + co;
  } else {
    const on1 = rng.unit() < 0.8 ? rng.pick(D.simple_onsets) : "";
    const nu1 = rng.weighted(D.nuclei, D.nuclei_w);
    let co1 = "", on2;
    if (rng.unit() < 0.4) {
      co1 = rng.weighted(MEDIAL_CODAS, MEDIAL_CODAS.map(c => MEDIAL_W[c]));
      on2 = rng.pick(JOIN[co1]);
    } else {
      on2 = rng.pick(D.simple_onsets);
    }
    const nu2 = rng.weighted(D.nuclei, D.nuclei_w);
    const co2 = rng.unit() < 0.45 ? rng.weighted(D.codas, D.codas_w) : "";
    w = on1 + nu1 + co1 + on2 + nu2 + co2;
  }
  return w;
}
function wellFormed(w) {
  if (w.length !== 4) return false;
  if (/(.)\1\1/.test(w)) return false;                   // no tripled letters
  if (/[aeiouy]{3}/.test(w)) return false;               // no three vowels running
  if (/^(.)\1/.test(w)) return false;                    // no doubled first letter
  if (/yy|iy|yi|uu|ii/.test(w)) return false;            // vowel pairs that don't read
  if (/^y/.test(w)) return false;                        // y is a vowel in this dialect, so never a first letter
  if (/n[iy]g|f[aeiy]g|fu[ck]|[ck]um|d[iy][ck]|kik|kyk|spi[ck]|coon/.test(w)) return false;   // nothing that sounds like a slur or an obscenity
  const syls = parse(w);
  if (!syls) return false;
  // a cluster ending in a liquid doesn't close on the same liquid: "brir", "plel" stumble
  return !syls.some(s => s.on.length > 1 && s.co && "lr".includes(s.co[0]) && s.on.endsWith(s.co[0]));
}
function coin(rng, taken) {
  for (let tries = 0; tries < 400; tries++) {
    const w = coinOnce(rng);
    if (wellFormed(w) && !LEXICON.has(w) && !taken.has(w)) return w;
  }
  return null;
}

/* ---- the hero carousel: the headline, then a four-letter word one chevron away ---- */
const slides = document.querySelector(".hero .slides");
if (slides) {
  const panes = slides.querySelectorAll(".slide"), go = slides.querySelector(".slides__go");
  const word = slides.querySelector(".word"), inner = word.querySelector(".word__in"), more = slides.querySelector('[data-words="again"]');
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rng = new Rng(hash_seed(Date.now() + ":" + Math.random()));
  let on = false, font = null;

  // coined words only: anything in the dictionary is thrown back, and no word comes round twice in a visit
  const seen = new Set();
  function nextWord() {
    if (seen.size > 2000) seen.clear();
    let w = coin(rng, seen);
    if (!w) { seen.clear(); w = coin(rng, seen); }
    seen.add(w);
    return w;
  }
  // The word sits in a box of fixed height, set from page load, so neither the hero nor the page below ever moves:
  // the box plus the button row (button and type credit) match the headline (on phones, where the headline is short, the box is sized for a word
  // of average width instead and the hero is that much taller from the start). Within it the word is as wide as the
  // pane allows short of the chevron. Trapu Tall's capitals stand 1.4em.
  const room = () => panes[1].getBoundingClientRect().width - go.offsetWidth - 8;
  function box() {
    const foot = more.closest(".words-foot") || more, btn = foot.offsetHeight + parseFloat(getComputedStyle(foot).marginTop);
    let h = Math.min(panes[0].querySelector(".headline").offsetHeight - btn, innerHeight * 0.58);
    if (innerWidth < 640) h = Math.max(h, 1.4 * room() / 4.2);
    word.style.setProperty("--word-box", Math.floor(h) + "px");
    return h;
  }
  function fit() {
    const h = box();
    word.style.setProperty("--word-size", "100px");
    const w = inner.getBoundingClientRect().width || 1;
    word.style.setProperty("--word-size", Math.floor(Math.min(100 * room() / w, h / 1.4)) + "px");
  }
  box();
  document.fonts.ready.then(() => (inner.textContent ? fit() : box()));   // the headline's own size settles once its font is in
  function show(w) { inner.textContent = w; word.setAttribute("aria-label", w); fit(); }
  function another() {
    word.classList.add("is-turning");
    setTimeout(() => { show(nextWord()); word.classList.remove("is-turning"); }, calm ? 0 : 260);
  }
  function set(state) {
    on = state;
    if (on && !inner.textContent) show(nextWord());
    slides.classList.toggle("is-words", on);
    panes[0].inert = on; panes[1].inert = !on;
    go.setAttribute("aria-label", on ? "Back to the headline" : "Four-letter words");
  }
  function open(state) {
    if (state === on) return;
    font = font || document.fonts.load('100px "Trapu Tall"');
    font.then(() => set(state));
  }

  go.addEventListener("click", () => open(!on));
  more.addEventListener("click", another);
  word.addEventListener("click", another);
  slides.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") open(true);
    if (e.key === "ArrowLeft") open(false);
  });
  // a sideways swipe moves between the panes; a mostly vertical one is left to scroll the page
  let x0 = null, y0 = 0;
  slides.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  slides.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) open(dx < 0);
    x0 = null;
  }, { passive: true });
  addEventListener("resize", () => (inner.textContent ? fit() : box()));
}
})();
