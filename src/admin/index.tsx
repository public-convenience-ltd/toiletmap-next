import { Hono } from 'hono';
import { Env } from '../types';
import { login, callback, logout } from './auth';
import { loosList, loosCreate, loosCreatePost } from './pages/Loos';
import { contributorsList } from './pages/Contributors';
import { dashboard } from './pages/Dashboard';
import { requireAuth } from './middleware';

const admin = new Hono<{ Bindings: Env }>();

// Public routes (no auth required)
admin.get('/login', login);
admin.get('/callback', callback);

// Apply authentication middleware to all other routes
admin.use('*', requireAuth);

// Protected routes
admin.get('/logout', logout);
admin.get('/', dashboard);
admin.get('/loos', loosList);
admin.get('/loos/create', loosCreate);
admin.post('/loos', loosCreatePost);
admin.get('/contributors', contributorsList);

export { admin };
