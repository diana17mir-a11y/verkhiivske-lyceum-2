const express=require("express"),session=require("express-session"),multer=require("multer"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const app=express(), PORT=process.env.PORT||3000;
const ROOT=__dirname, DATA=path.join(ROOT,"data","content.json"), ADMIN=path.join(ROOT,"data","admin.json");
const pub=path.join(ROOT,"public"), imgDir=path.join(pub,"uploads","images"), docDir=path.join(pub,"uploads","docs");
for(const d of [path.dirname(DATA),imgDir,docDir]) fs.mkdirSync(d,{recursive:true});
function read(){return JSON.parse(fs.readFileSync(DATA,"utf8"))} function write(x){fs.writeFileSync(DATA,JSON.stringify(x,null,2),"utf8")}
function hash(p,s=crypto.randomBytes(16).toString("hex")){return {salt:s,hash:crypto.scryptSync(p,s,64).toString("hex")}}
if(!fs.existsSync(ADMIN)){const p=process.env.ADMIN_PASSWORD||"Lyceum2-Admin-2026!";const h=hash(p);fs.writeFileSync(ADMIN,JSON.stringify({login:process.env.ADMIN_LOGIN||"admin",...h},null,2))}
function auth(req,res,next){if(req.session.user)return next();res.status(401).json({error:"Unauthorized"})}
app.use(express.json({limit:"2mb"})); app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"change-this-session-secret-before-production",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax"}}));
const storage=(dir)=>multer({storage:multer.diskStorage({destination:dir,filename:(req,file,cb)=>cb(null,Date.now()+"-"+crypto.randomBytes(5).toString("hex")+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:25*1024*1024}});
const uploadImg=multer({storage:multer.diskStorage({destination:imgDir,filename:(req,file,cb)=>cb(null,Date.now()+"-"+crypto.randomBytes(5).toString("hex")+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:10*1024*1024}});
const uploadDoc=storage(docDir);
app.get("/api/content",(req,res)=>res.json(read())); app.get("/api/me",(req,res)=>res.json({loggedIn:!!req.session.user}));
app.post("/api/login",(req,res)=>{const a=JSON.parse(fs.readFileSync(ADMIN));if(req.body.login===a.login&&crypto.timingSafeEqual(Buffer.from(hash(req.body.password,a.salt).hash,"hex"),Buffer.from(a.hash,"hex"))){req.session.user=a.login;return res.json({ok:true})}res.status(401).json({error:"Неверный логин или пароль"})});
app.post("/api/logout",auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.put("/api/site",auth,(req,res)=>{let d=read();d.site={...d.site,...req.body};write(d);res.json(d.site)});
const collections=["news","docs","needs","teachers","achievements","links"];
for(const key of collections){
 app.post("/api/"+key,auth,(req,res)=>{let d=read();const item={id:Date.now().toString(),...req.body};d[key].unshift(item);write(d);res.json(item)});
 app.put("/api/"+key+"/:id",auth,(req,res)=>{let d=read(),i=d[key].findIndex(x=>x.id===req.params.id);if(i<0)return res.sendStatus(404);d[key][i]={...d[key][i],...req.body};write(d);res.json(d[key][i])});
 app.delete("/api/"+key+"/:id",auth,(req,res)=>{let d=read();d[key]=d[key].filter(x=>x.id!==req.params.id);write(d);res.json({ok:true})});
}
app.post("/api/photo",auth,uploadImg.single("photo"),(req,res)=>{let d=read();const item={id:Date.now().toString(),url:"/uploads/images/"+req.file.filename,title:req.body.title||req.file.originalname};d.photos.unshift(item);write(d);res.json(item)});
app.delete("/api/photo/:id",auth,(req,res)=>{let d=read(),p=d.photos.find(x=>x.id===req.params.id);if(p){try{fs.unlinkSync(path.join(pub,p.url.replace(/^\/+/,"")))}catch{} }d.photos=d.photos.filter(x=>x.id!==req.params.id);write(d);res.json({ok:true})});
app.post("/api/document-upload",auth,uploadDoc.single("document"),(req,res)=>{let d=read();const item={id:Date.now().toString(),title:req.body.title||req.file.originalname,url:"/uploads/docs/"+req.file.filename};d.docs.unshift(item);write(d);res.json(item)});
app.post("/api/password",auth,(req,res)=>{let a=JSON.parse(fs.readFileSync(ADMIN));if(req.body.old!==process.env.ADMIN_PASSWORD&&crypto.scryptSync(req.body.old,a.salt,64).toString("hex")!==a.hash)return res.status(400).json({error:"Старий пароль невірний"});const h=hash(req.body.new);fs.writeFileSync(ADMIN,JSON.stringify({login:a.login,...h},null,2));res.json({ok:true})});
app.get("/robots.txt",(req,res)=>res.type("text").send("User-agent: *\nAllow: /\nSitemap: "+req.protocol+"://"+req.get("host")+"/sitemap.xml"));
app.get("/sitemap.xml",(req,res)=>res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${req.protocol}://${req.get("host")}/</loc></url><url><loc>${req.protocol}://${req.get("host")}/admin</loc></url></urlset>`));
app.use(express.static(pub)); app.get("/admin",(req,res)=>res.sendFile(path.join(pub,"admin.html"))); app.get("/{*splat}",(req,res)=>res.sendFile(path.join(pub,"index.html")));
app.listen(PORT,()=>console.log("Ліцей v3.3 Full: http://localhost:"+PORT));
