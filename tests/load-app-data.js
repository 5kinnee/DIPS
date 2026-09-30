/* Reads index.html as text and extracts the two data tables tests need (PROCHEM, DISCS), so tests
   never hand-maintain a second copy of 49 dye colors. Fails loudly if either is missing, instead of
   quietly testing against an empty list. */
const fs=require("fs");
const path=require("path");

const INDEX_PATH=path.join(__dirname,"..","index.html");

function loadAppData(){
  const html=fs.readFileSync(INDEX_PATH,"utf8");
  const prochemMatch=html.match(/const PROCHEM=`([^`]*)`/);
  if(!prochemMatch)throw new Error("load-app-data: could not find `const PROCHEM=...` in index.html");
  const discsMatch=html.match(/const DISCS=(\[.*?\]);/);
  if(!discsMatch)throw new Error("load-app-data: could not find `const DISCS=...` in index.html");
  const PROCHEM=prochemMatch[1];
  let DISCS;
  try{DISCS=JSON.parse(discsMatch[1]);}
  catch(e){throw new Error("load-app-data: DISCS did not parse as JSON: "+e.message);}
  if(!PROCHEM.trim())throw new Error("load-app-data: PROCHEM was empty");
  if(!Array.isArray(DISCS)||!DISCS.length)throw new Error("load-app-data: DISCS was empty");
  return{PROCHEM,DISCS};
}

module.exports={loadAppData,INDEX_PATH};
