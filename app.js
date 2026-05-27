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

let estudiantesMateria = [];
let presentesSet = new Set();

// 🔐 LOGIN
function login(){
  auth.signInWithEmailAndPassword(email.value, password.value)
  .then(() => initApp());
}

function registrar(){
  auth.createUserWithEmailAndPassword(email.value, password.value);
}

function initApp(){
  loginScreen.style.display="none";
  app.style.display="block";
  mostrar("dashboard");
  cargarMaterias();
  listarEstudiantes();
}

function mostrar(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
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
    let li=document.createElement("li");
    li.textContent=doc.id;
    listaEstudiantes.appendChild(li);
  });
}

// 📚 MATERIAS
async function cargarMaterias(){
  materiaLista.innerHTML="";
  const snap = await db.collection("materias").get();

  snap.forEach(doc=>{
    materiaLista.add(new Option(doc.data().nombre, doc.id));
  });
}

// ▶ LISTA
async function iniciarLista(){
  presentesSet.clear();
  presentes.innerHTML="";

  const rel = await db.collection("materia_estudiante")
    .where("materiaId","==",materiaLista.value).get();

  estudiantesMateria=[];

  for(let r of rel.docs){
    let est=await db.collection("estudiantes")
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

// ✅ SIN DUPLICADOS
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
      faltantes.appendChild(li);
    }
  });
}

// 💾 GUARDAR
async function cerrarLista(){

  for(let est of estudiantesMateria){

    const key = `${est.cedula}_${fechaLista.value}_${materiaLista.value}`;

    await db.collection("asistencias").doc(key).set({
      cedula: est.cedula,
      materia: materiaLista.value,
      fecha: fechaLista.value,
      presente: presentesSet.has(est.cedula),
      profesor: auth.currentUser.email
    });
  }

  alert("Guardado");
}

// 📊 DASHBOARD
async function cargarDashboard(){

  let p=0,f=0;
  const snap = await db.collection("asistencias").get();

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

  const snap = await db.collection("asistencias")
    .where("cedula","==",cedulaReporte.value).get();

  let t=0,p=0;

  snap.forEach(d=>{
    t++;
    if(d.data().presente) p++;
  });

  reporte.innerHTML=`${(p/t*100||0).toFixed(1)}% asistencia`;
}

// 🚨 ALERTAS
async function generarAlertas(){

  alertas.innerHTML="";
  const est = await db.collection("estudiantes").get();

  for(let e of est.docs){

    let snap = await db.collection("asistencias")
      .where("cedula","==",e.id).get();

    let t=0,p=0;

    snap.forEach(d=>{
      t++;
      if(d.data().presente) p++;
    });

    if(t>0 && p/t < 0.7){
      let li=document.createElement("li");
      li.textContent=e.id + " baja asistencia";
      alertas.appendChild(li);
    }
  }
}

// 📅 HISTORIAL
async function cargarHistorial(){

  historialLista.innerHTML="";
  let q=db.collection("asistencias");

  if(filtroFecha.value){
    q=q.where("fecha","==",filtroFecha.value);
  }

  const snap = await q.get();

  snap.forEach(d=>{
    let li=document.createElement("li");
    li.textContent=`${d.data().cedula} - ${d.data().fecha}`;
    historialLista.appendChild(li);
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
``
