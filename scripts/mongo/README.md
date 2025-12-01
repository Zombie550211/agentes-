# MongoDB maintenance scripts

Tips and scripts to safely backup and clean the MongoDB used by this project.

Usage (PowerShell):

1. Install dependency (if not already present):

   npm install mongodb

2. Run script with `MONGO_URI` env or `--uri`:

   $env:MONGO_URI = 'mongodb+srv://user:pass@cluster.example/dbname'
   node scripts/mongo/backup.js --collections users,leads

All scripts accept `--uri` and `--collection`/`--collections` flags and will NOT change data unless explicitly intended (normalize / remove duplicates / create indexes).

Always run `backup.js` before calling destructive scripts.

Be careful: these scripts perform write operations. Review code before running in production.
