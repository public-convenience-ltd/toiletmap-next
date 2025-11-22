import { Hono } from 'hono';
import { Env } from '../types';
import { login, callback, logout } from './auth';
import { loosList, loosCreate } from './pages/Loos';
import { contributorsList } from './pages/Contributors';
import { dashboard } from './pages/Dashboard';

const admin = new Hono<{ Bindings: Env }>();

admin.get('/login', login);
admin.get('/callback', callback);
admin.get('/logout', logout);

admin.use('*', async (c, next) => {
    // TODO: Implement session check middleware
    await next();
});

admin.get('/', dashboard);
admin.get('/loos', loosList);
admin.get('/loos/create', loosCreate);
admin.post('/loos', async (c) => {
    // TODO: Handle form submission
    return c.redirect('/admin/loos');
});
admin.get('/contributors', contributorsList);

export { admin };
