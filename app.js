  const firebaseConfig = {
    apiKey: "AIzaSyD7dXhlgDUd_FMiOD-2tG9Sk2CTzNIcHWU",
    authDomain: "asistencialuis-9b378.firebaseapp.com",
    projectId: "asistencialuis-9b378",
    storageBucket: "asistencialuis-9b378.firebasestorage.app",
    messagingSenderId: "145173933947",
    appId: "1:145173933947:web:00930a77d5e24964aa57de"
  };

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

let role = null;
let estudiantesMateria = [];
let presentesSet = new Set();

// 🔐 AUTH
async function login(){
  const cred = await auth.signInWithEmailAndPassword(email.value, password.value);
  const doc = await db.collection("users").doc(cred.user.uid).get();
  role = doc.data()?.role || "profesor";
  initApp();
}

function registrar(){
  auth.createUserWithEmailAndPassword(email.value, password.value);
}

function logout(){
  auth.signOut();
  location.reload();
}

// 🔧 INIT
function initApp(){
  loginDiv.style.display="none";
  app.style.display="block";

  rolInfo.textContent = "Rol: " + role;

  if(role !== "admin"){
    adminPanel.style.display="none";
  }

  cargarMaterias();
  listarEstudiantes();
}

// 👥 ROLES
function asignarRol(){
  db.collection("users").doc(auth.currentUser.uid).set({
    email: auth.currentUser.email,
    role: rolNuevo.value
  });
}

// 👨‍🎓 ESTUDIANTES
function crearEstudiante(){
  db.collection("estudiantes").doc(cedula.value).set({
    cedula: cedula.value,
    nombres: nombres.value,
    apellidos: apellidos.value
  });
  listarEstudiantes();
}

async function listarEstudiantes(){
  listaEstudiantes.innerHTML="";
  const snap = await db.collection("estudiantes").get();

  snap.forEach(doc=>{
    let d = doc.data();
    let li = document.createElement("li");
    li.textContent = d.cedula;

    let btn = document.createElement("button");
    btn.textContent="QR";
    btn.onclick=()=>QRCode.toCanvas(null, d.cedula);

    li.appendChild(btn);
    listaEstudiantes.appendChild(li);
  });
}

// 📚 MATERIAS
async function cargarMaterias(){
  materiaLista.innerHTML="";
  materiaSelect.innerHTML="";

  const snap = await db.collection("materias").get();

  snap.forEach(doc=>{
    let opt=new Option(doc.data().nombre, doc.id);
    materiaLista.add(opt);
    materiaSelect.add(opt.cloneNode(true));
  });
}

function crearMateria(){
  db.collection("materias").add({ nombre: materiaNombre.value });
  cargarMaterias();
}

// 🔗 ASIGNAR
function asignar(){
  db.collection("materia_estudiante").add({
    cedula: cedulaAsignar.value,
    materiaId: materiaSelect.value
  });
}

// ▶️ LISTA
async function iniciarLista(){

  presentesSet.clear();
  presentes.innerHTML="";

  const rel = await db.collection("materia_estudiante")
    .where("materiaId","==",materiaLista.value).get();

  estudiantesMateria=[];

  for(let r of rel.docs){
    let est = await db.collection("estudiantes")
      .doc(r.data().cedula).get();

    estudiantesMateria.push(est.data());
  }

  actualizarFaltantes();
}

// 📷 QR
function iniciarEscaner(){
  new Html5Qrcode("reader").start(
    { facingMode:"environment" },
    {}, code=>registrarAsistencia(code)
  );
}

function registrarManual(){
  registrarAsistencia(manualCedula.value);
}

// ✅ EVITAR DUPLICADOS
async function registrarAsistencia(cedula){

  const key = `${cedula}_${fechaLista.value}_${materiaLista.value}`;
  const doc = await db.collection("asistencias").doc(key).get();

  if(doc.exists) return alert("Duplicado");

  presentesSet.add(cedula);
  actualizarFaltantes();
}

// 🔄 FALTANTES
function actualizarFaltantes(){
  faltantes.innerHTML="";
  estudiantesMateria.forEach(est=>{
    if(!presentesSet.has(est.cedula)){
      let li=document.createElement("li");
      li.textContent=est.cedula;
      li.onclick=()=>corregir(est.cedula);
      faltantes.appendChild(li);
    }
  });
}

// 🔒 GUARDAR
async function cerrarLista(){

  for(let est of estudiantesMateria){

    const key = `${est.cedula}_${fechaLista.value}_${materiaLista.value}`;

    await db.collection("asistencias").doc(key).set({
      cedula: est.cedula,
      materia: materiaLista.value,
      fecha: fechaLista.value,
      presente: presentesSet.has(est.cedula),
      hora: new Date().toLocaleTimeString(),
      profesor: auth.currentUser.email
    });
  }

  alert("Lista guardada");
}

// 🔐 CORREGIR + AUDITORÍA
async function corregir(cedula){

  let pass = prompt("Contraseña");

  await auth.signInWithEmailAndPassword(auth.currentUser.email, pass);

  presentesSet.add(cedula);

  await db.collection("auditoria").add({
    accion: "Correccion",
    usuario: auth.currentUser.email,
    fecha: new Date(),
    detalle: cedula
  });

  actualizarFaltantes();
}

// 📊 DASHBOARD
async function cargarDashboard(){
  let p=0,f=0;
  const snap=await db.collection("asistencias").get();

  snap.forEach(d=>{
    d.data().presente ? p++ : f++;
  });

  new Chart(grafico,{
    type:'pie',
    data:{
      labels:['Presentes','Faltantes'],
      datasets:[{data:[p,f]}]
    }
  });
}

// 📈 REPORTE
async function generarReporte(){
  reporte.innerHTML="";
  const snap = await db.collection("asistencias")
    .where("cedula","==",cedulaReporte.value).get();

  let total=0, pres=0;

  snap.forEach(d=>{
    total++;
    if(d.data().presente) pres++;
  });

  reporte.innerHTML=`Asistencia: ${(pres/total*100||0).toFixed(1)}%`;
}

// 🚨 ALERTAS
async function generarAlertas(){

  alertas.innerHTML="";
  const est = await db.collection("estudiantes").get();

  for(let e of est.docs){

    const snap = await db.collection("asistencias")
      .where("cedula","==",e.id).get();

    let t=0,p=0;
    snap.forEach(d=>{
      t++;
      if(d.data().presente) p++;
    });

    if(t>0 && p/t < 0.7){
      let li=document.createElement("li");
      li.textContent=e.id+" baja asistencia";
      alertas.appendChild(li);
    }
  }
}

// 📊 HISTORIAL
async function cargarHistorial(){

  historial.innerHTML="";
  let q=db.collection("asistencias");

  if(filtroFecha.value){
    q=q.where("fecha","==",filtroFecha.value);
  }

  const snap=await q.get();

  snap.forEach(d=>{
    let li=document.createElement("li");
    li.textContent=d.data().cedula;
    historial.appendChild(li);
  });
}

// 📥 EXPORTAR
async function exportar(){

  let csv="Cedula,Fecha,Presente\n";
  const snap=await db.collection("asistencias").get();

  snap.forEach(d=>{
    let x=d.data();
    csv+=`${x.cedula},${x.fecha},${x.presente}\n`;
  });

  let a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv]));
  a.download="asistencia.csv";
  a.click();
}
