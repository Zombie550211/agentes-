require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  const tlsInsecure = String(process.env.TLS_INSECURE || '') === '1';
  const client = new MongoClient(uri, {
    tlsAllowInvalidCertificates: tlsInsecure,
    tlsAllowInvalidHostnames: tlsInsecure,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 30000,
    appName: 'diagnose-guadalupe-team'
  });

  await client.connect();
  const dbName = process.env.MONGODB_DBNAME || 'crmagente';
  const db = client.db(dbName);
  const users = db.collection('users');

  const guadalupeId = '68af5441c61c405e2bb7b0dd';
  const gOid = new ObjectId(guadalupeId);

  const guadalupe = await users.findOne({ _id: gOid });
  const team = guadalupe?.team;

  const countTeam = team ? await users.countDocuments({ team }) : 0;
  const countTeamNonSup = team ? await users.countDocuments({ team, role: { $not: /supervisor/i } }) : 0;
  const countBySupervisorIdStr = await users.countDocuments({ supervisorId: guadalupeId });
  const countBySupervisorIdObj = await users.countDocuments({ supervisorId: gOid });

  const sampleBySupervisorId = await users.find({ $or: [{ supervisorId: guadalupeId }, { supervisorId: gOid }] }, { projection: { username: 1, role: 1, team: 1, supervisorId: 1 } }).limit(20).toArray();

  console.log(JSON.stringify({
    dbName,
    guadalupe: guadalupe ? { _id: String(guadalupe._id), username: guadalupe.username, role: guadalupe.role, team: guadalupe.team, supervisorId: guadalupe.supervisorId } : null,
    counts: {
      users_in_same_team: countTeam,
      users_in_same_team_non_supervisor: countTeamNonSup,
      users_with_supervisorId_string: countBySupervisorIdStr,
      users_with_supervisorId_objectId: countBySupervisorIdObj
    },
    sampleUsersWithSupervisorId: sampleBySupervisorId
  }, null, 2));

  await client.close();
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
