/* DIPS 0.5.0: every disc picture is drawn here (Story 0.5.0 A-B, Blueprint 0.5.0 §2-3).
   Classic script, loaded after combos.js and before local.js: one global DiscPreview plus seeded,
   drawPattern and drawDiscOn, moved from index.html so their call sites keep their names.
   The pattern is drawn on the device's graphics chip on ONE hidden shared surface and copied into each
   ordinary picture, so any number of pictures uses one surface. Without the chip (or when it stops
   working) every picture uses the flat drawing below, with no message and never a blank disc.
   The disc finish (rim shadow, flight-plate line, highlight) is the same 2D code on both paths. */

/* ---------- flat drawing: the disc without the graphics chip; every dye shows (Decision H) ---------- */
function seeded(s){return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}
function drawPattern(ctx,cols,W,c,r,pattern){
  const n=cols.length,TAU=Math.PI*2,rnd=seeded(11);
  /* A canvas too small to draw on gives r <= 0; without this guard the ring loop never ends. */
  if(!(r>1))return;
  const rings=(cx,cy,max)=>{let rad=r*.06,i=0;
    while(rad<max){const w=r*(.035+rnd()*.07),ph=rnd()*TAU;ctx.beginPath();
      for(let a=0;a<=TAU+.001;a+=.04){const rr=rad+Math.sin(a*3+ph)*w*.3+Math.sin(a*7+ph*2)*w*.12;const x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;a===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
      ctx.closePath();ctx.lineWidth=w;ctx.strokeStyle=cols[i%n];ctx.stroke();rad+=w*(.7+rnd()*.9);i++;}};
  const wave=(off,down)=>{ctx.beginPath();ctx.moveTo(0,down?W:0);for(let x=0;x<=W;x+=4)ctx.lineTo(x,c+off+Math.sin(x/W*TAU*1.5)*r*.05);ctx.lineTo(W,down?W:0);ctx.closePath();};
  /* Extra rings just inside the rim for dyes past a pattern's base ring count, .07 of the radius each. */
  const innerRings=(from,start)=>{for(let j=from;j<n;j++){const ro=start-(j-from)*.07;ctx.beginPath();ctx.arc(c,c,r*(ro-.035),0,TAU);ctx.lineWidth=r*.07;ctx.strokeStyle=cols[j];ctx.stroke();}};
  switch(pattern){
    case"spin":rings(c,c,r*1.04);break;
    case"offcenter":rings(c+r*.3,c-r*.2,r*1.7);break;
    case"lollipop":for(let i=0,rad=r*.05;rad<r*1.05;i++,rad+=r*.075){ctx.beginPath();ctx.arc(c,c,rad,0,TAU);ctx.lineWidth=r*.065;ctx.strokeStyle=cols[i%n];ctx.stroke();}break;
    case"starburst":{
      const N=20;
      for(let k=0;k<N;k++){const a=k/N*TAU+rnd()*.12,d=.07+rnd()*.05,len=r*(.85+rnd()*.3);
        ctx.beginPath();ctx.moveTo(c,c);ctx.lineTo(c+Math.cos(a-d)*len,c+Math.sin(a-d)*len);ctx.lineTo(c+Math.cos(a+d)*len,c+Math.sin(a+d)*len);ctx.closePath();
        ctx.fillStyle=cols[k%n];ctx.fill();}
      ctx.beginPath();ctx.arc(c,c,r*.14,0,TAU);ctx.fillStyle=cols[0];ctx.fill();break;}
    case"cells":{
      const cells=[];
      for(let t=0;t<600&&cells.length<46;t++){const rr=r*(.035+rnd()*.13),a=rnd()*TAU,dd=Math.sqrt(rnd())*r*.98,x=c+Math.cos(a)*dd,y=c+Math.sin(a)*dd;
        if(cells.every(q=>Math.hypot(q.x-x,q.y-y)>q.r+rr+2))cells.push({x,y,r:rr});}
      ctx.beginPath();ctx.rect(0,0,W,W);cells.forEach(q=>{ctx.moveTo(q.x+q.r,q.y);ctx.arc(q.x,q.y,q.r,0,TAU);});ctx.fillStyle=cols[0];ctx.fill("evenodd");
      cells.forEach((q,i)=>{const R=cellRoles(i,n);ctx.beginPath();ctx.arc(q.x,q.y,q.r,0,TAU);if(R.fill>=0){ctx.fillStyle=cols[R.fill];ctx.fill();}ctx.lineWidth=2.5;ctx.strokeStyle=cols[R.outline];ctx.stroke();});
      break;}
    case"swirl":{
      const arms=Math.max(2,n*2);ctx.lineCap="round";
      for(let j=0;j<arms;j++){const off=j/arms*TAU;ctx.beginPath();
        for(let th=0;th<=3.2*Math.PI;th+=.05){const rad=r*1.08*th/(3.2*Math.PI),x=c+Math.cos(th+off)*rad,y=c+Math.sin(th+off)*rad;th===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}
        ctx.lineWidth=r*.12;ctx.strokeStyle=cols[j%n];ctx.stroke();}
      break;}
    case"river":{
      ctx.save();ctx.translate(c,c);ctx.rotate(-.45);ctx.translate(-c,-c);
      for(let i=-4;i<14;i++){const y0=i*r*.19;ctx.beginPath();
        for(let x=-W*.5;x<=W*1.5;x+=5){const y=y0+Math.sin(x/W*Math.PI*2.4+i*.8)*r*.13+Math.sin(x/W*Math.PI*6+i)*r*.03;x===-W*.5?ctx.moveTo(x,y):ctx.lineTo(x,y);}
        ctx.lineWidth=r*(.06+rnd()*.08);ctx.strokeStyle=cols[((i%n)+n)%n];ctx.stroke();}
      ctx.restore();break;}
    case"full":
      if(n<2){ctx.fillStyle=cols[0];ctx.fillRect(0,0,W,W);break;}
      {/* Even bands from the bottom up, color 1 at the bottom; boundary j as in the engine. */
        const xs=[];for(let x=0;x<W;x+=2)xs.push(x);xs.push(W);
        const yb=(j,x)=>j<=0?W:j>=n?0:c+r*(1-2*j/n+.05*Math.sin(((x-c)/r+1)*.75*TAU+1.3*j));
        for(let k=0;k<n;k++){ctx.beginPath();xs.forEach((x,i)=>i?ctx.lineTo(x,yb(k,x)):ctx.moveTo(x,yb(k,x)));
          for(let i=xs.length-1;i>=0;i--)ctx.lineTo(xs[i],yb(k+1,xs[i]));ctx.closePath();ctx.fillStyle=cols[k];ctx.fill();}}
      break;
    case"doubledip":
      wave(-r*.12,true);ctx.fillStyle=cols[0];ctx.fill();
      if(cols[1]){wave(r*.12,false);ctx.fillStyle=cols[1];ctx.fill();}
      if(cols[2]){ctx.beginPath();ctx.arc(c,c,r*.95,0,TAU);ctx.lineWidth=r*.1;ctx.strokeStyle=cols[2];ctx.stroke();}
      innerRings(3,.90);
      break;
    case"dipfade":{
      const g=ctx.createLinearGradient(0,c+r,0,c-r);g.addColorStop(0,cols[0]);
      if(n===2)g.addColorStop(.45,cols[1]);
      if(n===3){g.addColorStop(.35,cols[1]);g.addColorStop(.65,cols[2]);}
      if(n>=4)for(let k=1;k<n;k++)g.addColorStop(k/n,cols[k]);
      g.addColorStop(1,"#ffffff");ctx.fillStyle=g;ctx.fillRect(0,0,W,W);break;}
    case"stencil":{
      ctx.beginPath();ctx.rect(0,0,W,W);
      for(let k=0;k<10;k++){const a=-Math.PI/2+k*Math.PI/5,rr=k%2?r*.2:r*.46,x=c+Math.cos(a)*rr,y=c+Math.sin(a)*rr;k?ctx.lineTo(x,y):ctx.moveTo(x,y);}
      ctx.closePath();ctx.fillStyle=cols[0];ctx.fill("evenodd");
      if(cols[1]){ctx.beginPath();ctx.arc(c,c,r*.96,0,TAU);ctx.lineWidth=r*.08;ctx.strokeStyle=cols[1];ctx.stroke();}
      innerRings(2,.92);
      break;}
  }
}

/* One disc picture: shadow, base, pattern (engine first, else the flat drawing), then the finish.
   Photo patterns draw nothing over the base while their photo loads (a fraction of a second); a photo
   that cannot be found draws the dyes as Swirl (Blueprint 0.5.0 Decision C). */
function drawDiscOn(cv,fallbackW,base,cols,pattern,blend){
  const ctx=cv.getContext("2d"),dpr=window.devicePixelRatio||1,W=cv.clientWidth||fallbackW,S=Math.max(1,Math.round(W*dpr));
  cv.width=S;cv.height=S;ctx.setTransform(S/W,0,0,S/W,0,0);
  const c=W/2,r=W/2-Math.max(3,W*.03),TAU=Math.PI*2;
  ctx.clearRect(0,0,W,W);
  ctx.beginPath();ctx.arc(c,c+Math.max(2,W*.014),r,0,TAU);ctx.fillStyle="rgba(0,0,0,.10)";ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(c,c,r,0,TAU);ctx.clip();
  ctx.fillStyle=base;ctx.fillRect(0,0,W,W);
  if(cols.length){
    let pat=pattern;
    if(isPhotoPattern(pat)){const st=DiscPreview.photoState(pat);pat=st==="missing"?"swirl":st==="ready"?pat:null;}
    if(pat&&!DiscPreview.drawInto(ctx,S,W,base,cols,pat,blend)){
      if(isPhotoPattern(pat))DiscPreview.flatPhoto(ctx,W,base,cols,pat,blend);
      else{ctx.globalCompositeOperation=blend;drawPattern(ctx,cols,W,c,r,pat);ctx.globalCompositeOperation="source-over";}
    }
  }
  let g=ctx.createRadialGradient(c,c,r*.78,c,c,r);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,"rgba(0,0,0,.22)");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,W);
  ctx.beginPath();ctx.arc(c,c,r*.83,0,TAU);ctx.lineWidth=1.5;ctx.strokeStyle="rgba(0,0,0,.12)";ctx.stroke();
  ctx.beginPath();ctx.arc(c,c,r*.83+2,0,TAU);ctx.strokeStyle="rgba(255,255,255,.18)";ctx.stroke();
  g=ctx.createRadialGradient(c-r*.35,c-r*.45,0,c-r*.35,c-r*.45,r*.95);g.addColorStop(0,"rgba(255,255,255,.28)");g.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=g;ctx.fillRect(0,0,W,W);
  ctx.restore();
  ctx.beginPath();ctx.arc(c,c,r,0,TAU);ctx.lineWidth=1;ctx.strokeStyle="rgba(0,0,0,.3)";ctx.stroke();
}

/* ---------- the graphics-chip engine ---------- */
const DiscPreview=(()=>{
  const TAU=Math.PI*2,MAXD=MAX_DYES,MAXSIDE=1400,PHOTO_MODE=11;
  const MODES=Object.setPrototypeOf({spin:0,offcenter:1,lollipop:2,cells:3,swirl:4,river:5,starburst:6,full:7,doubledip:8,dipfade:9,stencil:10},null);
  const ATTRS={alpha:true,premultipliedAlpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true};
  /* One small program per pattern family, built only when a picture first needs it, so no picture
     waits for code it does not use. */
  const FAMILY=Object.setPrototypeOf({spin:"RINGS",offcenter:"RINGS",lollipop:"RINGS",swirl:"RINGS",river:"RINGS",
    starburst:"STAR",cells:"CELLS",full:"DIPS",doubledip:"DIPS",dipfade:"DIPS",stencil:"DIPS"},null);
  const famOf=pattern=>isPhotoPattern(pattern)?"PHOTO":FAMILY[pattern]||null;
  const api={onChange(){},source(){return"";}};
  /* gl: the one shared surface's context. par: the browser's background compiling, when it has it.
     progs: family -> {status "compiling" | "ready" | "failed", prog, U}. wanted: families asked for. */
  let cv=null,gl=null,par=null,started=false,queued=false,notifyQueued=false;
  const progs=new Map(),wanted=new Set();

  /* The 0.4.1 rings and river bands, from the same seeded(11) sequence the flat drawing uses, in disc units.
     Three numbers per ring (radius, width, phase); up to 48 rings, the shader's limit. */
  const ringList=max=>{const rnd=seeded(11),out=[];let rad=.06;while(rad<max&&out.length<48*3){const w=.035+rnd()*.07,ph=rnd()*TAU;out.push(rad,w,ph);rad+=w*(.7+rnd()*.9);}return new Float32Array(out);};
  const RINGS={spin:ringList(1.04),offcenter:ringList(1.7)};
  const BANDS=(()=>{const rnd=seeded(11),out=[];for(let i=0;i<18;i++)out.push(.06+rnd()*.08);return new Float32Array(out);})();
  /* Clean-picture limit (Story 0.5.0 AC-5): two neighboring wobbly rings or wavy bands either keep a gap,
     or an overlap, at least m wide all along (m: the thinnest line allowed, Blueprint 0.5.0 §3.5), or they
     meet exactly halfway between them all along. Otherwise the gap or overlap thins to a sliver that
     reads as specks. Flags per ring/band: [meets inner/upper neighbor, meets outer/lower neighbor]. */
  const ringR=(R,i,a)=>R[3*i]+Math.sin(a*3+R[3*i+2])*R[3*i+1]*.3+Math.sin(a*7+R[3*i+2]*2)*R[3*i+1]*.12;
  function ringSnaps(R,m){
    const n=R.length/3,s=new Float32Array(96);
    for(let i=0;i+1<n;i++){
      let lo=Infinity,hi=-Infinity;
      for(let k=0;k<720;k++){const a=k/720*TAU,g=(ringR(R,i+1,a)-R[3*i+4]/2)-(ringR(R,i,a)+R[3*i+1]/2);if(g<lo)lo=g;if(g>hi)hi=g;}
      if(lo<m&&hi>-m){s[2*i+1]=1;s[2*i+2]=1;}
    }
    return s;
  }
  function bandSnaps(m,K){
    const s=new Float32Array(36),P=Math.PI;
    const yb=(i,x)=>(i-4)*.19+Math.sin(x*P*2.4+(i-4)*.8)*.13+Math.sin(x*P*6+i-4)*.03;
    const sl=(i,x)=>(Math.cos(x*P*2.4+(i-4)*.8)*P*2.4*.13+Math.cos(x*P*6+i-4)*P*6*.03)*K;
    for(let i=0;i+1<18;i++){
      let lo=Infinity,hi=-Infinity;
      for(let k=0;k<=600;k++){
        const x=-.05+1.1*k/600,g=((yb(i+1,x)-BANDS[i+1]/2)-(yb(i,x)+BANDS[i]/2))/Math.sqrt(1+((sl(i,x)+sl(i+1,x))/2)**2);
        if(g<lo)lo=g;if(g>hi)hi=g;
      }
      if(lo<m&&hi>-m){s[2*i+1]=1;s[2*i+2]=1;}
    }
    return s;
  }
  const snapCache=new Map();
  const snapsFor=(key,make)=>{let s=snapCache.get(key);if(!s){s=make();snapCache.set(key,s);}return s;};

  const VS=`#version 300 es
in vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
  /* Shapes from the approved mock-up (Blueprint 0.5.0 §3.5), with a 1.5 device-pixel edge
     everywhere (Blueprint 0.5.0 §3.4) and the 0.4.1 geometry for the rings, river and dips. */
  const FS=`#version 300 es
precision highp float;
precision highp int;
#define MAXD ${MAXD}
out vec4 o;
uniform vec2 uC;uniform float uR;uniform float uK;
uniform vec3 uBase;uniform vec3 uDye[MAXD];uniform int uN;uniform int uBlend;uniform int uMode;
uniform vec3 uRing[48];uniform int uRingN;uniform vec2 uRingC;uniform float uBand[18];
uniform vec2 uSnap[48];uniform vec2 uBandS[18];
uniform sampler2D uPhoto;uniform vec3 uCen[MAXD];
const float PI=3.14159265,TAU=6.2831853;
float ringAt(int i,float a){vec3 R=uRing[i];return R.x+sin(a*3.+R.z)*R.y*.3+sin(a*7.+R.z*2.)*R.y*.12;}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21)+.1373);p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+1.),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.1;a*=.5;}return s/.9375;}
/* coverage from a true distance in disc units (negative inside), over 1.5 device pixels */
float cov(float d,float px){return clamp(.5-d/(1.5*px),0.,1.);}
vec3 dyeOn(vec3 col,vec3 dye,float w){return uBlend==1?mix(col,min(col,dye),w):col*(1.-w*(1.-dye));}
float fadeStop(int i){if(uN==2)return .45;if(uN==3)return i==1?.35:.65;return float(i)/float(uN);}
void main(){
  float px=1./uR;
  vec2 p=(gl_FragCoord.xy-uC)/uR;p.y=-p.y;
  float rho=length(p);
  if(rho>1.+3.*px){o=vec4(0);return;}
  float w[MAXD];for(int i=0;i<MAXD;i++)w[i]=0.;
  vec3 col=uBase;int lineK=-1;float lineW=0.,seam=0.;
#ifdef F_RINGS
  if(uMode==0||uMode==1){
    vec2 q=p-uRingC;float a=atan(q.y,q.x),rq=length(q);
    /* uSnap: this ring meets its inner (x) / outer (y) neighbor exactly halfway (ringSnaps) */
    for(int i=0;i<48;i++){if(i>=uRingN)break;
      float rr=ringAt(i,a),hw=uRing[i].y*.5,lo=rr-hw,hi=rr+hw;
      if(uSnap[i].x>.5){int j=max(i-1,0);lo=.5*(lo+ringAt(j,a)+uRing[j].y*.5);}
      if(uSnap[i].y>.5){int j=min(i+1,47);hi=.5*(hi+ringAt(j,a)-uRing[j].y*.5);}
      w[i%uN]+=cov(max(lo-rq,rq-hi),px);}
  }
  if(uMode==2){
    /* The 0.4.1 look keeps a thin disc-colored line between rings, but its .01 gap is thinner than a line may
       be (AC-5): the gap is exactly the thinnest line allowed, and each ring narrows to keep the even spacing. */
    float hw=(.075-max(1.5*px,.012))*.5;
    for(int i=0;i<15;i++){float rad=.05+.075*float(i);if(rad>=1.05)break;
      w[i%uN]+=cov(abs(rho-rad)-hw,px);}
  }
#endif
#ifdef F_CELLS
  if(uMode==3){
    float sc=6.5;vec2 q=p*sc+(vec2(fbm(p*2.5),fbm(p*2.5+9.))-.5)*1.2;
    float d1=9.,d2=9.;vec2 id=vec2(0);
    for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=floor(q)+vec2(x,y);
      vec2 pt=g+.15+.7*vec2(h21(g),h21(g+31.7));float dd=length(q-pt);
      if(dd<d1){d2=d1;d1=dd;id=g;}else if(dd<d2)d2=dd;}
    float minL=max(1.5*px,.012),lace=max(.10+.08*h21(id+5.),minL*sc);
    float t=(d2-d1-lace)/(2.*sc);
    float inside=cov(-t,px);
    int idx=int(h21(id)*64.)%64;
    int fill=uN>1?1+idx%(uN-1):-1;
    if(fill>=0)w[fill]+=inside;
    w[0]+=1.-inside*.97;
    lineK=(idx+1)%uN;lineW=cov(abs(t)-max(minL,.016)*.5,px);
  }
#endif
#ifdef F_RINGS
  if(uMode==4){
    float arms=float(max(2,uN)),b=1./(2.2*PI),g=arms/(TAU*b);
    float r2=rho+(fbm(p*3.+9.)-.5)*.05,th=atan(p.y,p.x)+(fbm(p*2.+3.)-.5)*1.2;
    float u=mod((th-r2/b)/TAU*arms,arms),j0=floor(u),f=u-j0;
    int k0=int(mod(j0,arms))%uN,k1=int(mod(j0+1.,arms))%uN;
    float t=cov(-(f-.5)/g,px);
    w[k0]+=1.-t;w[k1]+=t;
    float hw=max(px*g*3.75+.015,max(1.5*px,.012)*.5*g);
    seam=smoothstep(hw,0.,abs(f-.5))*.3;
  }
  if(uMode==5){
    vec2 d=p*uK,f=.5+vec2(cos(.45)*d.x-sin(.45)*d.y,sin(.45)*d.x+cos(.45)*d.y);
    /* band centers and slopes in disc units; uBandS: meets its upper (x) / lower (y) neighbor halfway (bandSnaps) */
    float yb[18],sl[18],fy=f.y/uK;
    for(int i=0;i<18;i++){float fi=float(i-4),a1=f.x*PI*2.4+fi*.8,a2=f.x*PI*6.+fi;
      yb[i]=fi*.19+sin(a1)*.13+sin(a2)*.03;sl[i]=(cos(a1)*PI*2.4*.13+cos(a2)*PI*6.*.03)*uK;}
    for(int i=0;i<18;i++){
      float lo=yb[i]-uBand[i]*.5,hi=yb[i]+uBand[i]*.5;
      if(uBandS[i].x>.5){int j=max(i-1,0);lo=.5*(lo+yb[j]+uBand[j]*.5);}
      if(uBandS[i].y>.5){int j=min(i+1,17);hi=.5*(hi+yb[j]-uBand[j]*.5);}
      w[(i-4+4*uN)%uN]+=cov(max(lo-fy,fy-hi)/sqrt(1.+sl[i]*sl[i]),px);}
  }
#endif
#ifdef F_STAR
  if(uMode==6){
    float th=atan(p.y,p.x)+(fbm(p*2.2+3.)-.5)*.5*rho;
    int N=uN*int(ceil(24./float(uN)));float base=PI/float(N);
    for(int i=0;i<48;i++){if(i>=N)break;
      float fi=float(i),a=fi/float(N)*TAU+(h21(vec2(fi,1.))-.5)*.15,len=.78+h21(vec2(fi,2.))*.27;
      float hw=base*(1.2-.55*rho)*sqrt(smoothstep(len,len-.3,rho))*(.8+.4*fbm(vec2(rho*3.,fi*1.7)))*rho;
      float dd=abs(mod(th-a+PI,TAU)-PI)*rho;
      w[i%uN]+=cov(dd-hw,px)*smoothstep(.05,.17,rho)*smoothstep(len,len-.08,rho);}
    float cr=.15+(fbm(p*5.)-.5)*.06;
    w[0]+=cov(rho-cr,px);
  }
#endif
#ifdef F_DIPS
  if(uMode==7){
    if(uN==1)w[0]=1.;
    else{float prev=1.;
      for(int j=1;j<MAXD;j++){if(j>=uN)break;
        float yb=1.-2.*float(j)/float(uN)+.05*sin((p.x+1.)*.75*TAU+float(j)*1.3);
        float above=cov(p.y-yb,px);w[j-1]=prev-above;prev=above;}
      w[uN-1]=prev;}
  }
  if(uMode==8){
    float wv=.05*sin((.5+p.x*uK)*TAU*1.5);
    w[0]=1.-cov(p.y-(-.12+wv),px);
    if(uN>1)w[1]=cov(p.y-(.12+wv),px);
    if(uN>2)w[2]=cov(.90-rho,px); /* the rim runs right out to the disc's edge */
    for(int j=3;j<MAXD;j++){if(j>=uN)break;float ro=.90-float(j-3)*.07;w[j]=cov(abs(rho-(ro-.035))-.035,px);}
  }
  if(uMode==9){
    float t=(1.-p.y)*.5;vec3 dc=uDye[0];
    if(t>0.){float s0=0.;vec3 c0=uDye[0];bool done=false;
      for(int i=1;i<=MAXD;i++){bool last=i>=uN;float si=last?1.:fadeStop(i);vec3 ci=last?vec3(1.):uDye[min(i,MAXD-1)];
        if(t<=si){dc=mix(c0,ci,(t-s0)/max(si-s0,1e-6));done=true;break;}
        c0=ci;s0=si;if(last)break;}
      if(!done)dc=vec3(1.);}
    col=dyeOn(col,dc,1.);
  }
  if(uMode==10){
    float ph=abs(mod(atan(p.y,p.x+1e-6)+PI*.5+PI*.2,PI*.4)-PI*.2);
    vec2 q=rho*vec2(cos(ph),sin(ph));
    vec2 T=vec2(.46,0.),I=.2*vec2(cos(PI*.2),sin(PI*.2)),e=I-T,nv=normalize(vec2(e.y,-e.x));
    w[0]=1.-cov(dot(nv,q-T),px);
    if(uN>1)w[1]=cov(.92-rho,px); /* the rim runs right out to the disc's edge */
    for(int j=2;j<MAXD;j++){if(j>=uN)break;float ro=.92-float(j-2)*.07;w[j]=cov(abs(rho-(ro-.035))-.035,px);}
  }
#endif
#ifdef F_PHOTO
  {
    vec3 c=texture(uPhoto,p*.5+.5).rgb;float ws=0.,dmin=9.;
    for(int k=0;k<MAXD;k++){if(k>=uN)break;vec3 dv=c-uCen[k];dmin=min(dmin,dot(dv,dv));}
    /* Each spot takes its nearest group's dye, blending only where two groups are about equally near (.002),
       so the drawn areas follow the group sizes even when a photo's groups are close in color (Story 0.5.0 AC-16). */
    for(int k=0;k<MAXD;k++){if(k>=uN)break;vec3 dv=c-uCen[k];w[k]=exp(-(dot(dv,dv)-dmin)/.002);ws+=w[k];}
    vec3 acc=vec3(0);float lc=0.;
    for(int k=0;k<MAXD;k++){if(k>=uN)break;float wk=w[k]/max(ws,1e-6);acc+=wk*dyeOn(uBase,uDye[k],1.);lc+=wk*dot(uCen[k],vec3(.299,.587,.114));w[k]=0.;}
    col=acc*mix(1.,clamp(dot(c,vec3(.299,.587,.114))/max(lc,.03),.7,1.3),.6);
  }
#endif
  for(int k=0;k<MAXD;k++){if(k>=uN)break;col=dyeOn(col,uDye[k],clamp(w[k],0.,1.));}
  if(lineK>=0)col=dyeOn(col,uDye[lineK],lineW);
  col*=1.-seam;
  o=vec4(clamp(col,0.,1.),1.);
}`;

  /* ---------- never freezing the page (Story 0.5.0 AC-20, North Star P4/P6) ----------
     Building a program can take seconds on some graphics chips, so nothing here runs while the page
     starts: the surface is made after the first screen is painted, each family's program is built in
     the background (KHR_parallel_shader_compile) and only checked once the browser says it is done.
     Until a picture's program is ready it uses the flat drawing; when one becomes ready every picture
     redraws on the engine (onChange). A browser without background compiling builds each program in
     its own task after the first paint. */
  function queueStart(){
    if(queued)return;
    queued=true;
    const go=()=>setTimeout(start,0);
    if(typeof requestAnimationFrame==="function")requestAnimationFrame(go);
    setTimeout(start,500); /* a page that is not painting (hidden) still starts */
  }
  function start(){
    if(started)return;
    started=true;
    try{
      cv=document.createElement("canvas");cv.width=cv.height=1;
      cv.addEventListener("webglcontextlost",e=>{e.preventDefault();progs.clear();});
      cv.addEventListener("webglcontextrestored",()=>{
        photos.forEach(ph=>{ph.tex=null;});
        try{setup();wanted.forEach(compile);}catch(_){}
      });
      gl=cv.getContext("webgl2",ATTRS);
      if(!gl)return;
      setup();
      wanted.forEach(compile);
    }catch(_){gl=null;}
  }
  /* The full-screen triangle every program draws, at attribute 0. */
  function setup(){
    par=gl.getExtension("KHR_parallel_shader_compile");
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  }
  const live=()=>!!gl&&!gl.isContextLost();
  function want(fam){
    wanted.add(fam);
    if(live()&&!progs.has(fam))compile(fam);
  }
  /* Starts building one family's program. Asking for its status before the browser has finished is
     what blocks, so it is only asked once finished (or, without background compiling, in a later task). */
  function compile(fam){
    if(!live()||progs.has(fam))return;
    const p={status:"compiling",prog:null,U:null};
    progs.set(fam,p);
    try{
      const sh=(t,s)=>{const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x;};
      p.prog=gl.createProgram();
      gl.attachShader(p.prog,sh(gl.VERTEX_SHADER,VS));
      gl.attachShader(p.prog,sh(gl.FRAGMENT_SHADER,FS.replace("#define MAXD",`#define F_${fam}\n#define MAXD`)));
      gl.bindAttribLocation(p.prog,0,"a");
      gl.linkProgram(p.prog);
    }catch(_){p.status="failed";return;}
    const check=()=>{
      if(progs.get(fam)!==p||!live())return; /* lost meanwhile: rebuilt on restore */
      if(par&&!gl.getProgramParameter(p.prog,par.COMPLETION_STATUS_KHR)){setTimeout(check,16);return;}
      finish(p);
    };
    setTimeout(check,par?16:0);
  }
  function finish(p){
    try{
      if(!gl.getProgramParameter(p.prog,gl.LINK_STATUS)){p.status="failed";return;}
      gl.useProgram(p.prog);
      p.U={};["uC","uR","uK","uBase","uDye","uN","uBlend","uMode","uRing","uRingN","uRingC","uBand","uSnap","uBandS","uPhoto","uCen"].forEach(n=>{p.U[n]=gl.getUniformLocation(p.prog,n);});
      if(p.U.uBand)gl.uniform1fv(p.U.uBand,BANDS);
      if(p.U.uPhoto)gl.uniform1i(p.U.uPhoto,0);
      p.status="ready";
      notify();
    }catch(_){p.status="failed";}
  }
  /* One redraw for any number of programs finishing together. */
  function notify(){
    if(notifyQueued)return;
    notifyQueued=true;
    setTimeout(()=>{notifyQueued=false;api.onChange();},0);
  }
  /* "none" (no surface), "waiting" (asked for, not started yet), "compiling", "ready" or "failed". */
  function state(pattern){
    const fam=famOf(pattern);
    if(!fam)return"none";
    want(fam);queueStart();
    if(!started)return"waiting";
    if(!live())return"none";
    const p=progs.get(fam);
    return p?p.status:"waiting";
  }
  const rgb01=h=>hex2rgb(h).map(v=>v/255);

  /* Renders the disc interior (pattern over the base, no finish) at S device pixels and copies it into
     ctx, which is already clipped to the disc. Returns false when the engine cannot draw it (yet). */
  function drawInto(ctx,S,W,base,cols,pattern,blend){
    if(state(pattern)!=="ready")return false;
    const P=progs.get(famOf(pattern)),U=P.U;
    const photo=isPhotoPattern(pattern),mode=photo?PHOTO_MODE:MODES[pattern];
    if(mode===undefined)return false;
    const k=Math.min(cols.length,MAXD);if(!k)return false;
    let ph=null;
    if(photo){ph=photos.get(pattern);if(!ph||ph.status!=="ready"||(!ph.tex&&!upload(ph)))return false;}
    try{
      const D=Math.min(S,MAXSIDE),rCss=W/2-Math.max(3,W*.03);
      if(cv.width!==D){cv.width=D;cv.height=D;}
      gl.viewport(0,0,D,D);gl.useProgram(P.prog);
      gl.uniform2f(U.uC,D/2,D/2);gl.uniform1f(U.uR,rCss*D/W);gl.uniform1f(U.uK,rCss/W);
      gl.uniform3fv(U.uBase,rgb01(base));
      const dy=new Float32Array(MAXD*3);cols.slice(0,k).forEach((h,i)=>dy.set(rgb01(h),i*3));gl.uniform3fv(U.uDye,dy);
      gl.uniform1i(U.uN,k);gl.uniform1i(U.uBlend,blend==="darken"?1:0);gl.uniform1i(U.uMode,mode);
      const m=Math.max(1.5*W/(rCss*D),.012); /* the thinnest line allowed, in disc units */
      if(mode<=1){const R=RINGS[pattern];gl.uniform3fv(U.uRing,R);gl.uniform1i(U.uRingN,R.length/3);gl.uniform2f(U.uRingC,mode?.3:0,mode?-.2:0);
        gl.uniform2fv(U.uSnap,snapsFor(`${pattern}:${m.toFixed(4)}`,()=>ringSnaps(R,m)));}
      if(mode===5)gl.uniform2fv(U.uBandS,snapsFor(`river:${m.toFixed(4)}:${(rCss/W).toFixed(4)}`,()=>bandSnaps(m,rCss/W)));
      if(photo){const g=groupsOf(ph,k),cen=new Float32Array(MAXD*3);g.centers.forEach((q,j)=>cen.set(q,j*3));gl.uniform3fv(U.uCen,cen);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,ph.tex);}
      gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,3);
      if(gl.isContextLost())return false;
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(cv,0,0,D,D,0,0,S,S);ctx.restore();
      return true;
    }catch(_){return false;}
  }

  /* ---------- photo patterns (Blueprint 0.5.0 §3.6) ---------- */
  const photos=new Map(),GRID=128,FLAT=256;
  function photo(key){
    let ph=photos.get(key);
    if(ph)return ph;
    ph={status:"loading",img:null,px:null,grid:null,sample:null,tex:null,groups:new Map()};
    photos.set(key,ph);
    let url="";try{url=api.source(key)||"";}catch(_){}
    if(!url){ph.status="missing";return ph;}
    const img=new Image();
    img.onload=()=>{try{sample(ph,img);ph.img=img;ph.status="ready";}catch(_){ph.status="missing";}api.onChange();};
    img.onerror=()=>{ph.status="missing";api.onChange();};
    img.src=url;
    return ph;
  }
  /* A 128 x 128 grid inside the circle for the color groups, and a 256 x 256 copy for the flat recolor. */
  function sample(ph,img){
    /* "high" smoothing averages the photo down, as the mipmapped texture does when the disc is drawn */
    const grab=n=>{const c=document.createElement("canvas");c.width=c.height=n;const x=c.getContext("2d",{willReadFrequently:true});x.imageSmoothingQuality="high";x.drawImage(img,0,0,n,n);return x.getImageData(0,0,n,n).data;};
    const d=grab(GRID),px=[],grid=new Int32Array(GRID*GRID).fill(-1);
    for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){
      /* the whole drawn disc, so group sizes are counted over exactly the area the dyer sees (AC-16) */
      const u=(x+.5)/GRID*2-1,v=(y+.5)/GRID*2-1;if(u*u+v*v>1)continue;
      const i=(y*GRID+x)*4;grid[y*GRID+x]=px.length/3;px.push(d[i]/255,d[i+1]/255,d[i+2]/255);
    }
    ph.px=new Float32Array(px);ph.grid=grid;ph.sample=grab(FLAT);
  }
  /* Groups for k dyes, worked out once per photo and dye count (cached), with their touch pairs.
     The group colors are fitted on the 128 grid (quick); their sizes, and so which dye each group gets,
     are counted on the 256 copy over the whole disc, the resolution the disc is drawn at. At 128 the
     photo's thin features (spokes, lacing) average into blends that land in other groups, so 128-grid
     sizes drifted 1-2% from the drawn areas (AC-16). */
  function groupsOf(ph,k){
    let g=ph.groups.get(k);
    if(g)return g;
    const pg=photoGroups(ph.px,k),cnt=new Array(k).fill(0),s=ph.sample;
    for(let y=0;y<FLAT;y++)for(let x=0;x<FLAT;x++){
      const u=(x+.5)/FLAT*2-1,v=(y+.5)/FLAT*2-1;if(u*u+v*v>1)continue;
      const i=(y*FLAT+x)*4,r=s[i]/255,gg=s[i+1]/255,b=s[i+2]/255;let best=0,bd=Infinity;
      for(let j=0;j<k;j++){const q=pg.centers[j],d=(r-q[0])**2+(gg-q[1])**2+(b-q[2])**2;if(d<bd){bd=d;best=j;}}
      cnt[best]++;
    }
    const rank=[...Array(k).keys()].sort((a,b)=>cnt[b]-cnt[a]||a-b),pos=new Array(k);
    rank.forEach((j,p)=>{pos[j]=p;});
    const labels=new Int16Array(GRID*GRID).fill(-1);
    for(let i=0;i<labels.length;i++)if(ph.grid[i]>=0)labels[i]=pos[pg.labels[ph.grid[i]]];
    g={centers:rank.map(j=>pg.centers[j]),counts:rank.map(j=>cnt[j]),labels,touch:groupTouchPairs(labels,GRID,k)};
    ph.groups.set(k,g);
    return g;
  }
  function upload(ph){
    try{
      let src=ph.img;
      const big=Math.max(src.naturalWidth,src.naturalHeight);
      if(big>1024){const c=document.createElement("canvas"),s=1024/big;c.width=Math.round(src.naturalWidth*s);c.height=Math.round(src.naturalHeight*s);c.getContext("2d").drawImage(src,0,0,c.width,c.height);src=c;}
      const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      /* Mipmaps: a disc drawn smaller than the photo averages its pixels instead of picking scattered ones,
         so thin features show at the share the groups count (AC-16) and do not shimmer. */
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);
      gl.generateMipmap(gl.TEXTURE_2D);
      ph.tex=t;return true;
    }catch(_){ph.tex=null;return false;}
  }
  /* Without the graphics chip: each pixel of the 256 copy takes its nearest group's dye over the base,
     with the same light and dark detail factor as the engine, drawn into the clipped disc (AC-21). */
  function flatPhoto(ctx,W,base,cols,key,blend){
    const ph=photos.get(key);if(!ph||ph.status!=="ready")return false;
    const k=Math.min(cols.length,MAXD);if(!k)return false;
    const g=groupsOf(ph,k),B=hex2rgb(base),pred=cols.slice(0,k).map(h=>blendRgb(B,hex2rgb(h),blend));
    const lc=g.centers.map(q=>.299*q[0]+.587*q[1]+.114*q[2]),src=ph.sample,img=new ImageData(FLAT,FLAT),out=img.data;
    for(let i=0;i<src.length;i+=4){
      const r=src[i]/255,gg=src[i+1]/255,b=src[i+2]/255;let best=0,bd=Infinity;
      for(let j=0;j<k;j++){const q=g.centers[j],d=(r-q[0])**2+(gg-q[1])**2+(b-q[2])**2;if(d<bd){bd=d;best=j;}}
      const f=1+(Math.min(1.3,Math.max(.7,(.299*r+.587*gg+.114*b)/Math.max(lc[best],.03)))-1)*.6;
      out[i]=pred[best][0]*f;out[i+1]=pred[best][1]*f;out[i+2]=pred[best][2]*f;out[i+3]=255;
    }
    const sc=document.createElement("canvas");sc.width=sc.height=FLAT;sc.getContext("2d").putImageData(img,0,0);
    const c=W/2,r=W/2-Math.max(3,W*.03);
    ctx.drawImage(sc,c-r,c-r,2*r,2*r);
    return true;
  }

  return Object.assign(api,{
    /* With no pattern: the graphics chip's surface is up. With a pattern: the engine can draw that
       pattern now (asking starts its program). False while starting, without the chip, or while lost. */
    ready:pattern=>pattern===undefined?(queueStart(),started&&live()):state(pattern)==="ready",
    /* The engine's state for a pattern's program: "none", "waiting", "compiling", "ready" or "failed". */
    state,
    drawInto,flatPhoto,
    /* "loading", "ready" or "missing"; asking starts the load. onChange fires when it finishes. */
    photoState:key=>photo(key).status,
    /* Touching color groups for k dyes, or null until the photo is ready. */
    photoTouch:(key,k)=>{const ph=photo(key);return ph.status==="ready"&&k>0?groupsOf(ph,Math.min(k,MAXD)).touch:null;},
    /* The groups for k dyes (centers and counts by size, label map on the 128 grid), or null. */
    photoGroupsOf:(key,k)=>{const ph=photo(key);return ph.status==="ready"&&k>0?groupsOf(ph,Math.min(k,MAXD)):null;}
  });
})();
