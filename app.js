// CONFIG
const firebaseConfig =as";const firebaseConfig = {
  }
}

// REGISTRO
async function registrar(){
  await auth.createUserWithEmailAndPassword(email.value,password.value);
}

// ESTUDIANTE
async function crearEstudiante(){

  if(!validarCedula(cedula.value)){
    alert("Cédula inválida"); return;
  }

  if(!validarNombre(nombres.value)){
    alert("Nombre inválido"); return;
  }

  if(!validarNombre(apellidos.value)){
    alert("Apellidos inválidos"); return;
  }

  await db.collection("estudiantes")
    .doc(cedula.value)
    .set({
      cedula:cedula.value,
      nombres:nombres.value,
      apellidos:apellidos.value
    });

  listarEstudiantes();
}

// LISTAR ESTUDIANTES
async function listarEstudiantes(){
  listaEstudiantes.innerHTML="";
  let snap=await db.collection("estudiantes").get();

  snap.forEach(doc=>{
    let e=doc.data();

    let li=document.createElement("li");
    li.textContent=e.cedula;

    let btn=document.createElement("button");
    btn.textContent="Editar";
    btn.onclick=()=>abrirAlumno(e);

    li.appendChild(btn);
    listaEstudiantes.appendChild(li);
  });
}

// ABRIR ALUMNO
async function abrirAlumno(e){
  alumnoActual=e;
  detalleCedula.textContent=e.cedula;
  editarNombres.value=e.nombres;
  editarApellidos.value=e.apellidos;

  await cargarMateriasAlumno(e.cedula);
  await cargarMaterias();

  mostrar("detalleAlumno");
}

// GUARDAR ALUMNO
async function guardarAlumno(){

  if(isEmpty(editarNombres.value)){
    alert("Nombre requerido"); return;
  }

  if(!validarNombre(editarNombres.value)){
    alert("Nombre inválido"); return;
  }

  if(isEmpty(editarApellidos.value)){
    alert("Apellido requerido"); return;
  }

  await db.collection("estudiantes")
    .doc(alumnoActual.cedula)
    .update({
      nombres:editarNombres.value,
      apellidos:editarApellidos.value
    });

  alert("Actualizado");
}

// MATERIAS DEL ALUMNO
async function cargarMateriasAlumno(ced){

  materiasAlumno.innerHTML="";

  let snap=await db.collection("materia_estudiante")
    .where("cedula","==",ced).get();

  for(let d of snap.docs){

    let rel=d.data();
    let mat=await db.collection("materias")
      .doc(rel.materiaId).get();

    let li=document.createElement("li");
    li.textContent=mat.data().nombre;

    let b=document.createElement("button");
    b.textContent="Quitar";
    b.onclick=async()=>{
      await db.collection("materia_estudiante")
        .doc(d.id).delete();
      cargarMateriasAlumno(ced);
    };

    li.appendChild(b);
    materiasAlumno.appendChild(li);
  }
}

// AGREGAR MATERIA
async function agregarMateriaAlumno(){

  let mid=agregarMateriaSelect.value;

  if(isEmpty(mid)){
    alert("Selecciona materia");
    return;
  }

  await db.collection("materia_estudiante").add({
    cedula: alumnoActual.cedula,
    materiaId: mid
  });

  cargarMateriasAlumno(alumnoActual.cedula);
}

// CREAR MATERIA
async function crearMateria(){

  if(isEmpty(materiaNombre.value)){
    alert("Nombre requerido");
    return;
  }

  await db.collection("materias").add({
    nombre: materiaNombre.value
  });

  cargarMaterias();
}

// LISTAR MATERIAS
async function cargarMaterias(){

  listaMaterias.innerHTML="";
  agregarMateriaSelect.innerHTML="";

  let snap=await db.collection("materias").get();

  snap.forEach(d=>{

    let m=d.data();

    let opt=new Option(m.nombre,d.id);
    agregarMateriaSelect.appendChild(opt);

    let li=document.createElement("li");
    li.textContent=m.nombre;

    let btn=document.createElement("button");
    btn.textContent="Editar";
    btn.onclick=()=>editarMateria(d.id,m.nombre);

    li.appendChild(btn);
    listaMaterias.appendChild(li);
  });
}

// EDITAR MATERIA
function editarMateria(id,nombre){
  materiaActual=id;
  editarMateriaNombre.value=nombre;
  mostrar("editarMateriaScreen");
}

// GUARDAR MATERIA
async function guardarMateria(){

  if(isEmpty(editarMateriaNombre.value)){
    alert("Nombre requerido");
    return;
  }

  await db.collection("materias")
    .doc(materiaActual)
    .update({
      nombre: editarMateriaNombre.value
    });

  mostrar("materiasScreen");
  cargarMaterias();
}

  apiKey: "TU_API",
  authDomain: "TU_DOM",
  projectId: "TU_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

let alumnoActual = null;
let materiaActual = null;

// UI
function mostrar(id){
  document.querySelectorAll(".screen")
  .forEach(s=>s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// VALIDACIONES
function isEmpty(v){ return !v || v.trim()==""; }
function validarCedula(v){ return /^[0-9]+$/.test(v); }
function validarNombre(v){ return /^[A-Za-z\s]+$/.test(v); }

// LOGIN
async function login(){
  let emailV=email.value.trim();
  let pass=password.value;

  if(isEmpty(emailV)){
    error-email.textContent="Correo requerido";
    return;
  }

  if(isEmpty(pass)){
    error-password.textContent="Password requerido";
    return;
  }

  try{
    await auth.signInWithEmailAndPassword(emailV,pass);
    app.style.display="block";
    loginScreen.style.display="none";
    mostrar("dashboard");
    listarEstudiantes();
    cargarMaterias();
  }catch(e){
