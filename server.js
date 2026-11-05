const cors = require("cors");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cors());

const DB_FILE = path.join(__dirname, "data.json");

// OWNER LOGIN
const ADMIN_USER = process.env.BITEZ_ADMIN_USER || "admin";
const ADMIN_PASS = process.env.BITEZ_ADMIN_PASS || "Bitez@123";

const sessions = new Map();

function hash(value){
  return crypto.createHash("sha256").update(value).digest();
}

function safeEqual(a,b){
  return crypto.timingSafeEqual(hash(a),hash(b));
}

function getCookie(req,name){
  const cookies=(req.headers.cookie||"").split(";");

  for(const c of cookies){
    const [k,...v]=c.trim().split("=");
    if(k===name)return decodeURIComponent(v.join("="));
  }
  return "";
}

function auth(req,res,next){
  const token=getCookie(req,"bitez_session");
  if(token&&sessions.has(token)){
    req.admin=true;
    return next();
  }
  return res.status(401).json({error:"Please login"});
}

const defaultData={
  menu:[
    {name:"Aloo Pyaz Paratha",price:30,available:true},
    {name:"Paneer Pyaz Paratha",price:40,available:true},
    {name:"Cold Drink 250 ml",price:20,available:true},
    {name:"Cold Drink 750 ml",price:40,available:true},
    {name:"Chips",price:20,available:true},
    {name:"Dahi Cup",price:22,available:true},
    {name:"Sandwich",price:60,available:true},
    {name:"Maggi",price:50,available:true},
    {name:"Burger",price:40,available:true},
    {name:"Fries",price:50,available:true}
  ],
  orders:[],
  config:{
    upiId:"akashtraders1580@sbi",
    payee:"AKASH TRADERS",
    eta:20
  }
};

function readDB(){
  if(!fs.existsSync(DB_FILE)){
    fs.writeFileSync(DB_FILE,JSON.stringify(defaultData,null,2));
  }

  const db=JSON.parse(fs.readFileSync(DB_FILE,"utf8"));
  db.menu ||= [];
  db.orders ||= [];
  db.config ||= {};

  if(!db.config.upiId||db.config.upiId==="YOUR_UPI_ID_HERE")
    db.config.upiId="akashtraders1580@sbi";

  if(!db.config.payee||db.config.payee==="BITEZ")
    db.config.payee="AKASH TRADERS";

  if(!db.config.eta)db.config.eta=20;

  db.menu.forEach((item,i)=>{
    if(item.id===undefined)item.id=String(i);
  });

  return db;
}

function writeDB(db){
  fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));
}

// LOGIN
app.post("/api/login",(req,res)=>{
  const {username,password}=req.body||{};

  if(!safeEqual(String(username||""),ADMIN_USER)||
     !safeEqual(String(password||""),ADMIN_PASS)){
    return res.status(401).json({error:"Invalid username or password"});
  }

  const token=crypto.randomBytes(32).toString("hex");
  sessions.set(token,{createdAt:Date.now()});

  res.setHeader("Set-Cookie",
    "bitez_session="+token+"; HttpOnly; SameSite=Strict; Path=/");

  res.json({success:true});
});

app.get("/api/me",auth,(req,res)=>{
  res.json({loggedIn:true,username:ADMIN_USER});
});

app.post("/api/logout",(req,res)=>{
  const token=getCookie(req,"bitez_session");
  if(token)sessions.delete(token);

  res.setHeader("Set-Cookie",
    "bitez_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");

  res.json({success:true});
});

// ADMIN PAGE
app.get("/admin",(req,res)=>{
  res.sendFile(path.join(__dirname,"admin.html"));
});

// Prevent direct admin.html access
app.get("/admin.html",(req,res)=>{
  res.redirect("/admin");
});

// CUSTOMER WEBSITE
app.get("/",(req,res)=>{
  res.sendFile(path.join(__dirname,"index.html"));
});

// MENU - PUBLIC
app.get("/api/menu",(req,res)=>{
  res.json(readDB().menu);
});

// CONFIG - PUBLIC READ
app.get("/api/config",(req,res)=>{
  const c=readDB().config;
  res.json({...c,upi:c.upiId,delivery:c.eta});
});

// CONFIG - ADMIN ONLY
app.put("/api/config",auth,(req,res)=>{
  const db=readDB(),b=req.body;

  if(b.upi!==undefined||b.upiId!==undefined)
    db.config.upiId=String(b.upi??b.upiId);

  if(b.payee!==undefined)db.config.payee=String(b.payee);

  if(b.delivery!==undefined||b.eta!==undefined)
    db.config.eta=Number(b.delivery??b.eta)||20;

  writeDB(db);
  res.json({...db.config,upi:db.config.upiId,delivery:db.config.eta});
});

// ITEM UPDATE - ADMIN ONLY
app.put("/api/items/:i",auth,(req,res)=>{
  const db=readDB(),key=String(req.params.i);

  const item=db.menu.find(x=>String(x.id)===key)||db.menu[Number(key)];

  if(!item)return res.status(404).json({error:"Item not found"});

  if(req.body.available!==undefined)
    item.available=Boolean(req.body.available);

  if(req.body.price!==undefined)
    item.price=Number(req.body.price);

  writeDB(db);
  res.json(item);
});

// CREATE ORDER - PUBLIC
app.post("/api/orders",(req,res)=>{
  const db=readDB();
  const {name,mobile,hostel,items,total}=req.body;

  if(!name||!mobile||!hostel||!Array.isArray(items)||!items.length||total===undefined){
    return res.status(400).json({error:"Please complete order details"});
  }

  const now=new Date().toISOString();

  const order={
    id:Date.now().toString(),
    name,
    customerName:name,
    mobile,
    customerPhone:mobile,
    hostel,
    items,
    total:Number(total),
    status:"New",
    payment:"Pending",
    paymentStatus:"Unpaid",
    createdAt:now,
    date:now,
    eta:Number(db.config.eta)||20
  };

  db.orders.unshift(order);
  writeDB(db);
  res.status(201).json(order);
});

// GET ORDERS - ADMIN ONLY
app.get("/api/orders",auth,(req,res)=>{
  res.json(readDB().orders);
});

// UPDATE ORDER - ADMIN ONLY
app.put("/api/orders/:id",auth,(req,res)=>{
  const db=readDB();

  const order=db.orders.find(o=>String(o.id)===String(req.params.id));
  if(!order)return res.status(404).json({error:"Order not found"});

  if(req.body.status)order.status=req.body.status;

  if(req.body.payment!==undefined){
    order.payment=req.body.payment;
    order.paymentStatus=req.body.payment==="Paid"?"Paid":
      req.body.payment==="Cash"?"Cash":"Unpaid";
  }

  if(req.body.paymentStatus!==undefined){
    order.paymentStatus=req.body.paymentStatus;
    order.payment=req.body.paymentStatus==="Paid"?"Paid":
      req.body.paymentStatus==="Cash"?"Cash":"Pending";
  }

  if(req.body.eta!==undefined)order.eta=Number(req.body.eta);

  writeDB(db);
  res.json(order);
});

// STATS - ADMIN ONLY
app.get("/api/stats",auth,(req,res)=>{
  const orders=readDB().orders;

  function dateParts(date){
    if(!date)return null;
    const d=new Date(date);
    if(isNaN(d))return null;
    return new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Kolkata",
      year:"numeric",month:"2-digit",day:"2-digit"
    }).format(d);
  }

  const today=dateParts(new Date());
  const month=today.slice(0,7);

  const todayOrders=orders.filter(o=>dateParts(o.createdAt||o.date)===today);
  const monthOrders=orders.filter(o=>dateParts(o.createdAt||o.date)?.slice(0,7)===month);

  function paid(o){
    return ["Paid","Cash"].includes(o.payment)||
           ["Paid","Cash"].includes(o.paymentStatus);
  }

  function revenue(list){
    return list.filter(paid).reduce((s,o)=>s+Number(o.total||0),0);
  }

  res.json({
    todayOrders:todayOrders.length,
    monthOrders:monthOrders.length,
    todayRevenue:revenue(todayOrders),
    monthRevenue:revenue(monthOrders),
    totalPaidRevenue:revenue(orders)
  });
});

// STATIC FILES
app.use(express.static(__dirname,{index:false}));

app.listen(PORT,()=>{
  console.log("BITEZ server running at http://localhost:"+PORT);
});
