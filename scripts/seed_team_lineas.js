#!/usr/bin/env node
/**
 * Seed/Upsert Team Líneas users grouped by supervisors.
 * - Password for all: LINEAS1
 * - Usernames are exactly as provided (case preserved), used as unique key.
 * - Roles:
 *    - Supervisors: 'Supervisor Team Lineas'
 *    - Agents: 'Lineas-Agentes'
 * - Teams:
 *    - Jonathan F group  -> team: 'team lineas jonathan'
 *    - Luis G group      -> team: 'team lineas luis'
 *
 * Usage:
 *  node scripts/seed_team_lineas.js            # dry-run (show plan)
 *  node scripts/seed_team_lineas.js --commit   # apply changes
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectToMongoDB, closeConnection } = require('../config/db');

const PASSWORD_PLAINTEXT = 'LINEAS1';
const TEAM_JONATHAN = 'team lineas jonathan';
const TEAM_LUIS = 'team lineas luis';

const supervisors = [
  { username: 'JONATHAN F', role: 'Supervisor Team Lineas', team: TEAM_JONATHAN, supervisor: 'JONATHAN F' },
  { username: 'LUIS G',     role: 'Supervisor Team Lineas', team: TEAM_LUIS,     supervisor: 'LUIS G' }
];

const agentsBySupervisor = {
  'JONATHAN F': [
    { username: 'VICTOR HURTADO' },
    { username: 'EDWARD RAMIREZ' },
    { username: 'CRISTIAN RIVERA' }
  ],
  'LUIS G': [
    { username: 'DANIEL DEL CID' },
    { username: 'FERNANDO BELTRAN' },
    { username: 'KARLA RODRIGUEZ' },
    { username: 'JOCELYN REYES' },
    { username: 'JONATHAN GARCIA' },
    { username: 'NANCY LOPEZ' }
  ]
};

function teamForSupervisor(name) {
  return name === 'JONATHAN F' ? TEAM_JONATHAN : TEAM_LUIS;
}

(async () => {
  const args = process.argv.slice(2);
  const doCommit = args.includes('--commit');
  try {
    const db = await connectToMongoDB();
    const users = db.collection('users');
    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(PASSWORD_PLAINTEXT, salt);

    const plan = [];

    // Supervisors
    supervisors.forEach(sup => {
      plan.push({
        filter: { username: sup.username },
        update: {
          $set: {
            username: sup.username,
            name: sup.username,
            role: sup.role,
            team: sup.team,
            supervisor: sup.username,
            password: hashed,
            updatedAt: new Date()
          },
          $setOnInsert: { createdAt: new Date() }
        }
      });
    });

    // Agents
    Object.entries(agentsBySupervisor).forEach(([sup, list]) => {
      const team = teamForSupervisor(sup);
      list.forEach(a => {
        plan.push({
          filter: { username: a.username },
          update: {
            $set: {
              username: a.username,
              name: a.username,
              role: 'Lineas-Agentes',
              team,
              supervisor: sup,
              password: hashed,
              updatedAt: new Date()
            },
            $setOnInsert: { createdAt: new Date() }
          }
        });
      });
    });

    // Execute
    console.log(`Plan de upsert para ${plan.length} usuarios (password=\"${PASSWORD_PLAINTEXT}\").`);
    for (const step of plan) {
      const existing = await users.findOne(step.filter);
      const action = existing ? 'update' : 'insert';
      console.log(`- ${action.toUpperCase()} -> ${step.filter.username} | role=${step.update.$set.role} | team=${step.update.$set.team} | supervisor=${step.update.$set.supervisor}`);
      if (doCommit) {
        await users.updateOne(step.filter, step.update, { upsert: true });
      }
    }

    if (!doCommit) {
      console.log('\nDRY-RUN: No se aplicaron cambios. Ejecuta con --commit para escribir en DB.');
    } else {
      console.log('\nCOMMIT: Cambios de usuarios aplicados.');
    }


    // Seed leads for Team Lineas
    const leadsCollection = db.collection('team_lineas_leads');
    const leadsPlan = [];
    const supervisorsWithAgents = Object.keys(agentsBySupervisor);

    for (let i = 0; i < 10; i++) {
      const supervisorName = supervisorsWithAgents[i % supervisorsWithAgents.length];
      const agents = agentsBySupervisor[supervisorName];
      const agent = agents[i % agents.length];
      const lead = {
        nombre_cliente: `CLIENTE DE PRUEBA ${i + 1}`,
        telefono_principal: `555-010${i}`,
        numero_cuenta: `ACC-TL-00${i}`,
        status: i % 3 === 0 ? 'completed' : 'pending',
        supervisor: supervisorName,
        agenteAsignado: agent.username,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      leadsPlan.push(lead);
    }

    if (doCommit) {
      console.log('\nBorrando leads anteriores de Team Lineas...');
      await leadsCollection.deleteMany({});
      console.log('Insertando nuevos leads de prueba...');
      await leadsCollection.insertMany(leadsPlan);
      console.log(`${leadsPlan.length} leads de prueba insertados en 'team_lineas_leads'.`);
    } else {
      console.log(`\nDRY-RUN: Se crearían ${leadsPlan.length} leads de prueba.`);
    }

  } catch (e) {
    console.error('Error en seed_team_lineas:', e?.message || e);
    process.exitCode = 1;
  } finally {
    try { await closeConnection(); } catch {}
  }
})();
