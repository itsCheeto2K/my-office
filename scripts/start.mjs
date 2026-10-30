#!/usr/bin/env node
// Cross-platform production launcher for MyOffice server
process.env.NODE_ENV = 'production';
import('../server/index.mjs');
