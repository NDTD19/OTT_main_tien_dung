
'use strict';

const prisma = require('../server/db');

async function main() {
  console.log('Checking OTTv2 PostgreSQL connection...');

  const [
    users,
    submissions,
    matches,
    tournaments
  ] = await Promise.all([
    prisma.user.count(),
    prisma.submission.count(),
    prisma.match.count(),
    prisma.tournament.count()
  ]);

  console.log('Database connection: SUCCESS');

  console.table({
    Users: users,
    Submissions: submissions,
    Matches: matches,
    Tournaments: tournaments
  });
}

main()
  .catch(error => {
    console.error('Database connection: FAILED');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
