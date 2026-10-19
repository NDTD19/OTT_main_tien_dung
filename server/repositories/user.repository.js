
'use strict';

const prisma = require('../db');

async function findByUsername(username) {
  return prisma.user.findUnique({
    where: { username: username.toLowerCase() }
  });
}

async function findById(id) {
  return prisma.user.findUnique({
    where: { id }
  });
}

async function createUser({
  username,
  passwordHash,
  email = null
}) {
  return prisma.user.create({
    data: {
      username: username.toLowerCase(),
      passwordHash,
      email,
      role: 'STUDENT'
    }
  });
}

module.exports = {
  findByUsername,
  findById,
  createUser
};
