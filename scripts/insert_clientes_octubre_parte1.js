const mongoose = require('mongoose');
const Costumer = require('../models/Costumer');

// Conectar a MongoDB
mongoose.connect('mongodb://localhost:27017/crm', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const clientes = [
  { nombre_cliente: "JUAN AGUILAR", telefono_principal: "6098402613", numero_cuenta: "251001486545814", autopago: true, direccion: "433 Walnut Ave Trenton NJ 08609", tipo_servicios: "XFINTY 500MBPS+", sistema: "SARA", riesgo: "N/A", dia_venta: "2025-10-01", dia_instalacion: "2025-10-04", status: "ACTIVE", servicios: "XFINTY 500MBPS+", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "ADQUIRIR SERVICIOS", porque_llamo: "ADQUIRIR SERVICIOS", zip_code: "08609", puntaje: 0.75, agenteNombre: "Giselle Diaz" },
  { nombre_cliente: "MIRNA MENDEZ", telefono_principal: "4482134734", numero_cuenta: "552625995662", autopago: true, direccion: "94 Americana St Tallahassee FL 32305", tipo_servicios: "ATT AIR", sistema: "SARA", riesgo: "LOW", dia_venta: "2025-10-01", dia_instalacion: "2025-10-03", status: "ACTIVE", servicios: "ATT AIR", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "CANCELAR SERVICIO ANTERIOR", porque_llamo: "PAGAR BILL", zip_code: "32305", puntaje: 0.35, agenteNombre: "mIguel Nunez" },
  { nombre_cliente: "ANA QUIÑONEZ", telefono_principal: "2404385917", numero_cuenta: "1644315915", autopago: true, direccion: "1404 Kanawha St Hyattsville MD 20783 APT 102", tipo_servicios: "INTERNET EARTHLINK 300 MB", sistema: "SARA", riesgo: "N/A", dia_venta: "2025-10-01", dia_instalacion: "2025-10-06", status: "ACTIVE", servicios: "EARTHLINK", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "ADQUIRIR SERVICIOS", porque_llamo: "ADQUIRIR SERVICIOS", zip_code: "20783", puntaje: 1.0, agenteNombre: "Tatiana Ayala" },
  { nombre_cliente: "HEIMY EUCEDA", telefono_principal: "4432734061", numero_cuenta: "553097613793", autopago: true, direccion: "6139 Macbeth Dr, Apt B, Baltimore, MD 21239", tipo_servicios: "ATT AIR", sistema: "SARA", riesgo: "HIGH", dia_venta: "2025-10-01", dia_instalacion: "2025-10-08", status: "ACTIVE", servicios: "ATT AIR", mercado: "BAMO", supervisor: "IRANIA", comentarios_venta: "ADQUIRIR SERVICIOS", porque_llamo: "ADQUIRIR SERVICIOS", zip_code: "21239", puntaje: 0.35, agenteNombre: "mIguel Nunez" },
  { nombre_cliente: "JEYMY MARTINEZ", telefono_principal: "3462348965", numero_cuenta: "251002486695686", autopago: true, direccion: "10803 Greencreek Dr Houston TX 77070", tipo_servicios: "XFINTY 500MBPS+", sistema: "N/A", riesgo: "N/A", dia_venta: "2025-10-02", dia_instalacion: "2025-10-05", status: "ACTIVE", servicios: "XFINTY 500MBPS+", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "ADQUIRIR SERVICIOS", porque_llamo: "ADQUIRIR SERVICIOS", zip_code: "77070", puntaje: 0.75, agenteNombre: "mIguel Nunez" },
  { nombre_cliente: "YOLANDA LARA", telefono_principal: "7542350244", telefono_alterno: "9292586794", numero_cuenta: "554766555605", autopago: true, direccion: "1304 S Parker Rd Denver CO 80231 APT 238", tipo_servicios: "ATT AIR", sistema: "SARA", riesgo: "LOW", dia_venta: "2025-10-02", dia_instalacion: "2025-10-07", status: "CANCEL", servicios: "ATT AIR", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "CANCELAR SERVICIO ANTERIOR", porque_llamo: "ATENCION AL CLIENTE", zip_code: "80231", puntaje: 0.35, agenteNombre: "Giselle Diaz" },
  { nombre_cliente: "JISAHUEY VASQUEZ", telefono_principal: "7722713047", telefono_alterno: "7722079614", numero_cuenta: "251002486707902", autopago: true, direccion: "2190 SW IDAHO LN, PORT SAINT LUCIE, FL 34953", tipo_servicios: "XFINTY 500MBPS+", sistema: "SARA", riesgo: "N/A", dia_venta: "2025-10-02", dia_instalacion: "2025-10-09", status: "CANCEL", servicios: "XFINTY 500MBPS+", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "ADQUIRIR SERVICIOS", porque_llamo: "ADQUIRIR SERVICIOS", zip_code: "34953", puntaje: 0.75, agenteNombre: "Giselle Diaz" },
  { nombre_cliente: "ROSA TORRES", telefono_principal: "2404320437", telefono_alterno: "2408878205", numero_cuenta: "251002486707834", autopago: true, direccion: "203 Lakeside Dr Greenbelt MD 20770 APT T3", tipo_servicios: "XFINTY 300MBPS", sistema: "SARA", riesgo: "N/A", dia_venta: "2025-10-02", dia_instalacion: "2025-10-06", status: "ACTIVE", servicios: "XFINTY 300MBPS", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "ADQUIRIR SERVICIOS", porque_llamo: "ADQUIRIR SERVICIOS", zip_code: "20770", puntaje: 0.35, agenteNombre: "Giselle Diaz" },
  { nombre_cliente: "ELAINE LEONMORENO SARAPALTIO", telefono_principal: "7866389763", telefono_alterno: "7869694272", numero_cuenta: "341249496", autopago: true, direccion: "141 E 62nd St Hialeah FL 33013", tipo_servicios: "ATT 300 - 500 MB", sistema: "SARA", riesgo: "LOW", dia_venta: "2025-10-02", dia_instalacion: "2025-10-06", status: "ACTIVE", servicios: "INTERNET", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "CANCELAR SERVICIO ANTERIOR", porque_llamo: "PROBLEMAS DE INTERNET", zip_code: "33013", puntaje: 1.25, agenteNombre: "Josue Renderos" },
  { nombre_cliente: "AIDA ALVAREZ", telefono_principal: "7865085005", telefono_alterno: "7865085006", numero_cuenta: "553303607788", autopago: true, direccion: "150 NE 79th St Miami FL 33138 APT 1507", tipo_servicios: "ATT AIR", sistema: "SARA", riesgo: "LOW", dia_venta: "2025-10-02", dia_instalacion: "2025-10-05", status: "CANCEL", servicios: "ATT AIR", mercado: "ICON", supervisor: "IRANIA", comentarios_venta: "CANCELAR SERVICIO ANTERIOR", porque_llamo: "PROBLEMAS DE INTERNET", zip_code: "33138", puntaje: 0.35, agenteNombre: "Tatiana Ayala" }
];

async function insertClientes() {
  try {
    console.log('Insertando', clientes.length, 'clientes...');
    const result = await Costumer.insertMany(clientes);
    console.log('✅ Clientes insertados correctamente:', result.length);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error insertando clientes:', error);
    process.exit(1);
  }
}

insertClientes();
