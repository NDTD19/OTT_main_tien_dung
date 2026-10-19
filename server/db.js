
'use strict';

// Load environment variables from .env
require('dotenv/config');

const { PrismaClient } = require('@prisma/client');

// Shared Prisma Client instance
const prisma = new PrismaClient({
  log: ['warn', 'error']
});

module.exports = prisma;
