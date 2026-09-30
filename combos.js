/* DIPS 0.2.0: color math, combo picker and color wheel, moved out of index.html so it can be
   checked by script (Story 0.2.0 §3, Blueprint 0.2.0). Classic script: these become globals when
   loaded via <script src="combos.js">, and index.html's call sites keep their existing names.
   No package.json; Node loads this file as CommonJS through the guarded export at the bottom.
   Numbers marked EST are starting estimates, to be tuned against logged discs (North Star P5). */

/* ---------- color math (verbatim from 0.1.1, index.html:1111-1148 at 348f1e7) ---------- */
function hex2rgb(h){h=h.replace("#","");if(h.length===3)h=h.split("").map(c=>c+c).join("");const n=parseInt(h,16);return[n>>16&255,n>>8&255,n&255];}
function rgb2hex(c){return"#"+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");}
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
/* Estimate: weighted geometric mean of each channel, the usual stand-in for subtractive (pigment) mixing. */
function mixRgb(a,pa,b,pb){return a.map((v,i)=>{const x=Math.max(v/255,.02),y=Math.max(b[i]/255,.02);return 255*Math.exp((pa*Math.log(x)+pb*Math.log(y))/(pa+pb));});}

/* blendRgb now takes the mixing math explicitly, since there is no shared state.blend outside the page. */
function blendRgb(a,b,mode){return mode==="darken"?a.map((v,i)=>Math.min(v,b[i])):a.map((v,i)=>v*b[i]/255);}

/* Predictions are always computed from an entry's own fields, so a logged entry stays consistent
   even if the app's math changes later. One blend implementation backs both the planner and the log. */
function predictHexes(baseHex,s,dyeHexes,mode){
  const base=hex2rgb(baseHex);
  return dyeHexes.map(h=>rgb2hex(blendRgb(base,soakRgb(hex2rgb(h),s),mode)));
}

/* Replaces the index.html:1107 PROCHEM mapping. */
function dyesFromText(text){
  return text.split("\n").map(l=>{const[code,name,hex]=l.split("|");return{id:code,code,name,hex,rgb:hex2rgb(hex),fam:code[3]};});
}

/* ---------- classification: same rules as 0.1.1 (index.html:1154-1179), base/strength/blend/label
   taken from setup instead of shared page state ---------- */
function classify(dye,setup){
  const base=setup.base,eff=soakRgb(dye.rgb,setup.strength),res=blendRgb(base,eff,setup.blend);
  const lb=lab(base),lr=lab(res),ld=lab(dye.rgb),d=dE(lb,lr);
  const darkDye=ld.C<25&&ld.L<45,baseLight=lb.L>80&&lb.C<15;
  const bn=setup.baseText,rn=nameColor(res),dn=dye.name;
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

const touchRgb=(a,b,mode)=>blendRgb(a.res,b.eff,mode);

/* ---------- which colors touch, per pattern (Story 0.2.0 AC-7) ---------- */
function comboTouchPairs(pattern,n){
  const kind={spin:"ring",offcenter:"ring",lollipop:"ring",swirl:"ring",river:"ring",starburst:"ring",
    cells:"cells",full:"none",doubledip:"double",dipfade:"chain",stencil:"first"}[pattern]||"ring";
  const pairs=kind==="cells"?[[0,1],[0,2]]
    :kind==="ring"?[[0,1],[1,2],[2,0]]
    :kind==="double"?[[0,1],[2,0],[2,1]]
    :kind==="chain"?[[0,1],[1,2]]
    :kind==="first"?[[0,1]]:[];
  return pairs.filter(([a,b])=>a<n&&b<n);
}

/* ---------- combo picker ---------- */
const DISTINCT=12; /* Doctrine Part 4: skip near-duplicates (dE < 12) */

/* Best first, but no dye leads more than one option, no dye in more than 2, no repeated mix of color
   families. Rules relax one at a time only if fewer than k qualify: first repeated family mixes are
   allowed, then a dye may lead twice and appear in up to 3 options (Story 0.2.0 AC-2). */
function pickVaried(cands,it,k=8){
  cands.sort((x,y)=>y.q-x.q);
  const picked=[],uses={},leadCount={},sigs=new Set(),seen=new Set();
  const key=s=>s.map(i=>it[i].r.dye.id).sort().join("|");
  const sig=s=>s.map(i=>it[i].fam).sort().join("+");
  const rules=[
    c=>!leadCount[c.s[0]]&&!sigs.has(sig(c.s))&&c.s.every(i=>(uses[i]||0)<2),
    c=>!leadCount[c.s[0]]&&c.s.every(i=>(uses[i]||0)<2),
    c=>(leadCount[c.s[0]]||0)<2&&c.s.every(i=>(uses[i]||0)<3),
  ];
  for(const ok of rules) for(const c of cands){
    if(picked.length>=k)break;
    const kk=key(c.s);
    if(seen.has(kk)||!ok(c))continue;
    seen.add(kk);picked.push(c);
    leadCount[c.s[0]]=(leadCount[c.s[0]]||0)+1;
    sigs.add(sig(c.s));
    c.s.forEach(i=>uses[i]=(uses[i]||0)+1);
  }
  return picked.map(c=>c.s.map(i=>it[i].r));
}

/* Every dye that won't go muddy on this disc is considered, no hard caps (Story 0.2.0 AC-1).
   pool: classify() results; setup: {techBase, pattern, blend}. Each type returns
   {key, title, options, touch, blurb}. Solid + rim and Bold + dark accent leave the muddy() penalty
   out of their scores, so touches with the trailing dark accent never rank an option down; the touch
   card still shows them, so a touch on black or dark brown reads "muddy" (Blueprint 0.2.0 answer 2,
   Story AC-8). Adding muddy() to those scores would undo that decision. */
function buildCombos(pool,setup){
  const it=pool.filter(r=>r.cat!=="mud").map(r=>{
    const l=lab(r.res),H=hue(r.res);
    return{r,l,L:l.L,C:l.C,H,dark:r.darkDye,pop:r.cat==="pop",
      fam:r.darkDye?"dark":l.C<12?"neutral":hueName(H),
      vis:Math.max(0,Math.min(1,(r.score-20)/90))};
  });
  const n=it.length;
  const mud=[],dist=[];
  for(let i=0;i<n;i++){
    mud[i]=[];dist[i]=[];
    for(let j=0;j<n;j++){
      mud[i][j]=i!==j&&isMud(blendRgb(it[i].r.res,it[j].r.eff,setup.blend));
      dist[i][j]=dE(it[i].l,it[j].l);
    }
  }
  const hd=(i,j)=>hueDist(it[i].H,it[j].H);
  const distinct=s=>s.every((a,x)=>s.every((b,y)=>y<=x||dist[a][b]>=DISTINCT));
  const muddy=(s,pattern)=>comboTouchPairs(pattern,s.length).filter(([a,b])=>mud[s[a]][s[b]]).length;
  const avgVis=s=>s.reduce((t,i)=>t+it[i].vis,0)/s.length;
  const sep=s=>{let m=99;s.forEach((a,x)=>s.forEach((b,y)=>{if(y>x)m=Math.min(m,dist[a][b]);}));return Math.min(1,m/40);};

  const idx=[...Array(n).keys()];
  const pops=idx.filter(i=>it[i].pop&&!it[i].dark);
  const chrom=pops.filter(i=>it[i].C>=15);
  const darks=idx.filter(i=>it[i].pop&&it[i].dark);
  const P=setup.pattern;

  /* Colors stepping around the wheel: each step 20-70 degrees (EST), third color keeps going. */
  function chains(maxTouchMud){
    const out=[];
    for(const a of chrom) for(const b of chrom){
      if(b===a||hd(a,b)<20||hd(a,b)>70||dist[a][b]<DISTINCT)continue;
      for(const c of chrom){
        if(c===a||c===b||hd(b,c)<20||hd(b,c)>70||hd(a,c)<35||!distinct([a,b,c]))continue;
        const s=[a,b,c],m=muddy(s,P);
        if(m>maxTouchMud)continue;
        out.push({s,q:0.55*avgVis(s)+0.2*sep(s)+0.2-0.3*m,span:hd(a,c)});
      }
      const s2=[a,b],m2=muddy(s2,P);
      if(m2<=maxTouchMud)out.push({s:s2,q:0.55*avgVis(s2)+0.2*sep(s2)-0.3*m2,span:hd(a,b)});
    }
    return out;
  }

  const types=[];
  const tb=setup.techBase;
  if(tb==="floetrol"){
    const c=[];
    for(const bg of idx){
      if(!it[bg].pop)continue;
      for(let x=0;x<pops.length;x++) for(let y=x+1;y<pops.length;y++){
        const a=pops[x],b=pops[y];
        if(a===bg||b===bg||!distinct([bg,a,b]))continue;
        const da=it[a].L-it[bg].L,db=it[b].L-it[bg].L;
        if(Math.sign(da)!==Math.sign(db))continue;            /* both cells lighter, or both darker */
        const dl=Math.min(Math.abs(da),Math.abs(db));
        if(dl<20)continue;                                    /* EST: lightness gap that reads as cells */
        const s=[bg,a,b],m=muddy(s,"cells");
        c.push({s,q:0.35*Math.min(1,dl/45)+0.35*avgVis(s)+0.15*Math.min(1,dist[a][b]/40)-0.2*m});
      }
    }
    types.push({key:"cells",title:"Background + cells",options:pickVaried(c,it),touch:"cells",
      blurb:o=>lab(o[1].res).L>lab(o[0].res).L
        ?"Color 1 is a darker background. Colors 2 and 3 are lighter cells that stand out against it."
        :"Color 1 is a lighter background. Colors 2 and 3 are darker cells that stand out against it."});
  }else if(tb==="spin"){
    const all=chains(3);
    const c3=all.filter(c=>c.s.length===3&&c.span>=50);
    types.push({key:"rainbow",title:"Rainbow progression",options:pickVaried(c3.length?c3:all.filter(c=>c.s.length===2),it),touch:P,
      blurb:()=>"Colors stepping around the color wheel, in ring order, so neighboring rings blend cleanly."});
  }else if(tb==="hotdip"){
    const c=[];
    for(const a of chrom) for(const d of darks){
      const s=[a,d];
      if(!distinct(s))continue;
      c.push({s,q:0.6*it[a].vis+0.4*Math.min(1,(it[a].L-it[d].L)/50)});
    }
    types.push({key:"solidrim",title:"Solid + rim",options:pickVaried(c,it),touch:P,
      blurb:o=>`Color 1 is the dip. Use ${o[1].dye.name} for a dark rim or a second, partial dip.`});
  }else{
    const c=[];
    const fam=idx.filter(i=>!it[i].dark&&it[i].C>=20);
    for(const a of fam) for(const b of fam){
      if(b===a||hueDist(it[a].H,it[b].H)>=30)continue;
      const g1=it[a].L-it[b].L;
      if(g1<12||g1>30)continue;
      let any=false;
      for(const d of fam){
        if(d===a||d===b||hueDist(it[a].H,it[d].H)>=30||it[b].L-it[d].L<12)continue;
        const s=[a,b,d];
        if(!distinct(s))continue;
        any=true;
        c.push({s,q:0.6*avgVis(s)+0.2-0.3*muddy(s,P)});
      }
      if(!any&&distinct([a,b]))c.push({s:[a,b],q:0.6*avgVis([a,b])-0.3*muddy([a,b],P)});
    }
    types.push({key:"lightdark",title:"Light to dark",options:pickVaried(c,it),touch:P,
      blurb:()=>"One color family from light to dark. Swirls and marbling read as depth instead of mud."});
  }

  types.push({key:"neighbors",title:"Neighbors",options:pickVaried(chains(0),it),touch:P,
    blurb:()=>"Close together on the color wheel, so where they bleed into each other they stay clean."});

  const ct=[];
  for(let x=0;x<chrom.length;x++) for(let y=x+1;y<chrom.length;y++){
    const a=chrom[x],b=chrom[y];
    if(hd(a,b)<100||dist[a][b]<DISTINCT)continue;
    ct.push({s:[a,b],q:0.5*hd(a,b)/180+0.5*avgVis([a,b])-0.15*muddy([a,b],P)});
  }
  types.push({key:"contrast",title:"High contrast",options:pickVaried(ct,it),touch:P,
    blurb:o=>isMud(blendRgb(o[0].res,o[1].eff,setup.blend))
      ?"Big contrast. Leave a gap between them, because where they touch they go muddy."
      :"Big contrast, and even where they touch it stays usable."});

  const bd=[];
  for(const a of chrom) for(const d of darks){
    if(!distinct([a,d]))continue;
    const gap=Math.min(1,(it[a].L-it[d].L)/50);
    bd.push({s:[a,d],q:0.6*it[a].vis+0.4*gap});
    for(const b of chrom){
      if(b===a||hd(a,b)<20||hd(a,b)>60||mud[a][b]||!distinct([a,b,d]))continue;
      bd.push({s:[a,b,d],q:0.6*avgVis([a,b])+0.4*gap});
    }
  }
  types.push({key:"bolddark",title:"Bold + dark accent",options:pickVaried(bd,it),touch:P,
    blurb:o=>`Use ${o[o.length-1].dye.name} for crisp lines, the rim, or the outer ring.`});

  return types.filter(t=>t.options.length);
}

/* ---------- color wheel and dial ---------- */
function hsvToRgb(h,s,v){const f=n=>{const k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1));};return[f(5),f(3),f(1)].map(x=>Math.round(x*255));}

/* angle = color (red at top, clockwise), distance from center = how vivid */
function wheelPos(rgb,C,R){
  const h=hue(rgb),[r,g,b]=rgb.map(v=>v/255),mx=Math.max(r,g,b),mn=Math.min(r,g,b),s=mx?(mx-mn)/mx:0;
  const a=h*Math.PI/180,d=s*R;
  return[C+d*Math.sin(a),C-d*Math.cos(a)];
}
function wheelPointToRgb(dx,dy,R){
  const s=Math.min(1,Math.hypot(dx,dy)/R),h=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
  return hsvToRgb(h,s,.95);
}

const DIAL={opp:[0,180],next:[-30,0,30],split:[0,150,210],tri:[0,120,240],sq:[0,90,180,270]};

/* results: classify() results for every dye on this disc. startRgb: the color the dial starts from.
   A white, grey or black start has no place on the dial (Story AC-14). */
function dialMatch(results,startRgb,type,spread=15){
  if(lab(startRgb).C<12)return{neutral:true};
  const h0=hue(startRgb);
  const pointers=DIAL[type].map(offset=>{
    const angle=(h0+offset+360)%360;
    const dyes=results.filter(r=>lab(r.res).C>=12&&hueDist(hue(r.res),angle)<=spread)
      .sort((x,y)=>(x.cat==="mud")-(y.cat==="mud")||y.score-x.score);
    return{offset,angle,dyes};
  });
  return{pointers};
}

/* Hues (0-359, stepped) that go muddy on this disc, for the wheel's grey rim band. */
function mudRimHues(setup,step=5){
  const hues=[];
  for(let h=0;h<360;h+=step){
    const dye={id:"t",code:"t",name:"t",rgb:hsvToRgb(h,.85,.75)};
    if(classify(dye,setup).cat==="mud")hues.push(h);
  }
  return hues;
}

if(typeof module==="object"&&module&&module.exports)module.exports={
  hex2rgb,rgb2hex,lab,dE,hue,hueDist,hueName,nameColor,isMud,soakRgb,mixRgb,
  blendRgb,predictHexes,dyesFromText,classify,touchRgb,comboTouchPairs,
  DISTINCT,pickVaried,buildCombos,hsvToRgb,wheelPos,wheelPointToRgb,DIAL,dialMatch,mudRimHues
};
