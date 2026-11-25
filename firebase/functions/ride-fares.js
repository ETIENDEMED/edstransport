const zones=['springbrook','penhold','gasoline-alley','red-deer-north','red-deer-south','innisfail','blackfalds','lacombe','yyc','yeg','other'];
const postalPattern=/^[T][0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$/i;
const embeddedPostal=/\b(T[0-9][ABCEGHJ-NPRSTV-Z])[ -]?([0-9][ABCEGHJ-NPRSTV-Z][0-9])\b/gi;
const pair=(a,b)=>[a,b].sort().join('|');
const routes=new Map([
  ['springbrook','penhold',700],['springbrook','gasoline-alley',700],
  ['red-deer-north','red-deer-north',1000],['red-deer-south','red-deer-south',1000],['red-deer-north','red-deer-south',1500],
  ['springbrook','red-deer-south',1500],['springbrook','red-deer-north',2000],
  ['penhold','red-deer-south',2000],['penhold','red-deer-north',2500]
].map(([a,b,price])=>[pair(a,b),{price,minimum:false}]));
const redDeer=zone=>zone==='red-deer-north'||zone==='red-deer-south';
const outOfTown=new Set(['innisfail','blackfalds','lacombe']);
function normalizePostal(value){
  const normalized=typeof value==='string'?value.replace(/[ -]/g,'').toUpperCase():'';
  return postalPattern.test(normalized)?normalized:null;
}
function zoneFor(postal,address,mapping){
  const provided=normalizePostal(postal);
  const embedded=[...new Set([...String(address||'').matchAll(embeddedPostal)].map(match=>(match[1]+match[2]).toUpperCase()))];
  if(embedded.length>1||(provided&&embedded.length&&embedded[0]!==provided)) return null;
  const zone=mapping[provided||embedded[0]];
  return zones.includes(zone)?zone:null;
}
function routeFare(from,to){
  if(!zones.includes(from)||!zones.includes(to)) return null;
  const redDeerPickupCents=redDeer(from)&&redDeer(to)?200:0;
  const regionalSurchargeCents=outOfTown.has(from)||outOfTown.has(to)?500:0;
  const fixed=routes.get(pair(from,to));
  const regionalMinimum=(from==='springbrook'&&to==='innisfail')||(from==='innisfail'&&to==='springbrook')
    ||(redDeer(from)&&outOfTown.has(to))||(redDeer(to)&&outOfTown.has(from));
  const airportMinimum=['yyc','yeg'].includes(from)||['yyc','yeg'].includes(to);
  const rate=fixed||(regionalMinimum?{price:2500,minimum:true}:airportMinimum?{price:17500,minimum:true}:null);
  return {from,to,routeBaseCents:rate?.price??null,minimum:rate?.minimum??false,redDeerPickupCents,regionalSurchargeCents};
}
module.exports={zones,normalizePostal,zoneFor,routeFare};
