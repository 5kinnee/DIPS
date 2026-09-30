/* FROZEN reference copy of DIPS 0.1.1 color math, verbatim from commit 348f1e7:
   hex2rgb, rgb2hex, blendRgb, soakRgb, lab, dE, hue, hueDist, hueName, nameColor, isMud
   (index.html:1111-1148), classify (index.html:1154-1179), predictHexes (index.html:1626-1629).
   `state`, `strength()` and `baseLabel()` are a local stub standing in for the page's shared state,
   so tests can set base/blend/strength before calling classify(). Never edit this file - it is the
   fixed point T19/T8 compare the new combos.js against. */

const state={base:"#ffffff",baseName:null,blend:"multiply",strengthVal:1};
function strength(){return state.strengthVal;}
function baseLabel(){return state.baseName?state.baseName.toLowerCase():nameColor(hex2rgb(state.base));}

function hex2rgb(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");const n=parseInt(h,16);return[n>>16&255,n>>8&255,n&255];}
function rgb2hex(c){return"#"+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");}
const blendRgb=(a,b)=>state.blend==="darken"?a.map((v,i)=>Math.min(v,b[i])):a.map((v,i)=>v*b[i]/255);
const soakRgb=(d,s)=>d.map(v=>255-(255-v)*s);
function lab(rgb){
  const [r,g,b]=rgb.map(c=>{c/=255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);});
  const X=(.4124*r+.3576*g+.1805*b)/.95047,Y=.2126*r+.7152*g+.0722*b,Z=(.0193*r+.1192*g+.9505*b)/1.08883;
  const f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;
  const fx=f(X),fy=f(Y),fz=f(Z),A=500*(fx-fy),B=200*(fy-fz);
  return{L:116*fy-16,a:A,b:B,C:Math.hypot(A,B)};
}
const dE=(p,q)=>Math.hypot(p.L-q.L,p.a-q.a,p.b-q.b);
function hue(rgb){
  const [r,g,b]=rgb.map(v=>v/255),mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  if(!d)return 0;let h;
  if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;
  return(h*60+360)%360;
}
const hueDist=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d;};
function hueName(h){
  if(h<12)return"red";if(h<40)return"orange";if(h<62)return"yellow";if(h<85)return"lime";
  if(h<150)return"green";if(h<185)return"teal";if(h<200)return"turquoise";if(h<250)return"blue";
  if(h<280)return"purple";if(h<320)return"magenta";if(h<345)return"pink";return"red";
}
function nameColor(rgb){
  const {L,C}=lab(rgb),h=hue(rgb);
  if(C<9)return L>88?"white":L>65?"light grey":L>35?"grey":L>18?"charcoal":"black";
  if(L<16)return"near black";
  if(C<20&&L<62)return(h<90||h>=330)?"muddy brown":(h>=180&&h<280)?"slate grey":"drab "+hueName(h);
  if((h>=12&&h<50&&L<52)||((h<12||h>=345)&&L<32&&C<45))return L<28?"dark brown":"brown";
  if(h>=50&&h<90&&L<48)return"olive";
  let n=hueName(h);
  if(n==="red"&&L>68)n="pink";
  if(L<32)return"deep "+n;
  if(L>84&&n!=="yellow")return"light "+n;
  return n;
}
const isMud=rgb=>{const l=lab(rgb);return l.L<16||(l.C<20&&l.L<62)||/brown|olive/.test(nameColor(rgb));};

function classify(dye){
  const base=hex2rgb(state.base),eff=soakRgb(dye.rgb,strength()),res=blendRgb(base,eff);
  const lb=lab(base),lr=lab(res),ld=lab(dye.rgb),d=dE(lb,lr);
  const darkDye=ld.C<25&&ld.L<45,baseLight=lb.L>80&&lb.C<15;
  const bn=baseLabel(),rn=nameColor(res),dn=dye.name;
  let cat,why;
  if(!darkDye&&lr.L<16){cat="mud";why="Goes nearly black. Disc and dye together block almost all light.";}
  else if(!darkDye&&lb.C>22&&((ld.C>30&&lr.C<20&&lr.L<72)||(hueDist(hue(base),hue(dye.rgb))>110&&/brown|olive/.test(rn)))){
    cat="mud";
    why=hueDist(hue(base),hue(dye.rgb))>110?`${dn} sits across the color wheel from ${bn}, so they cancel out to ${rn}.`:`The mix lands on ${rn}, a dull shade.`;
  }
  else if(!darkDye&&/brown|olive/.test(rn)&&!/brown|olive/.test(nameColor(dye.rgb))){cat="mud";why=`Turns ${rn} on this disc, which reads as muddy.`;}
  else if(d<14){
    cat="subtle";
    why=darkDye?"Barely darker than the disc. Not enough contrast to read."
      :(lb.C>22&&hueDist(hue(base),hue(dye.rgb))<35)?"Same color family as the disc, so it only deepens it. Good for tone-on-tone."
      :`Lands close to the disc color (${rn}), so it barely shows.`;
  }
  else{
    cat="pop";
    if(darkDye)why=`Strong dark contrast (${rn}). Great for outlines and rim rings.`;
    else if(baseLight)why=`Shows true on a light disc: ${rn}.`;
    else why=hueDist(hue(res),hue(eff))>25?`Turns ${rn} on this disc. What you pour is not what you get.`:`Stays clean: ${rn}.`;
  }
  return{dye,eff,res,cat,why,darkDye,score:cat==="mud"?-1:d+lr.C*.4};
}

function predictHexes(baseHex,s,dyeHexes,mode){
  const base=hex2rgb(baseHex);
  return dyeHexes.map(h=>{const eff=soakRgb(hex2rgb(h),s);return rgb2hex(mode==="darken"?base.map((v,i)=>Math.min(v,eff[i])):base.map((v,i)=>v*eff[i]/255));});
}

module.exports={state,strength,baseLabel,hex2rgb,rgb2hex,blendRgb,soakRgb,lab,dE,hue,hueDist,hueName,nameColor,isMud,classify,predictHexes};
