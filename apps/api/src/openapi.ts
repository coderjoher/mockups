// SC-2: OpenAPI 3.1 description of the public API. Contract tests validate real responses against these schemas.
const uuid = { type: 'string', format: 'uuid' };
const error = { type: 'object', required: ['error', 'message'], properties: { error: { type: 'string' }, message: { type: 'string' } } };
const project = {
  type: 'object',
  required: ['id', 'root_url', 'title', 'language', 'created_at'],
  properties: { id: uuid, root_url: { type: 'string' }, title: { type: 'string' }, language: { type: 'string' }, created_at: { type: 'string' }, brand_colors: { type: 'array', items: { type: 'string' } } },
};
const page = {
  type: 'object',
  required: ['id', 'url', 'title', 'selected'],
  properties: { id: uuid, url: { type: 'string' }, title: { type: 'string' }, selected: { type: 'boolean' }, template_group: { type: ['string', 'null'] }, lang: { type: ['string', 'null'] } },
};
const capture = {
  type: 'object',
  required: ['id', 'page_id', 'device', 'mode', 'status'],
  properties: {
    id: uuid, page_id: uuid, device: { enum: ['desktop', 'tablet', 'mobile'] }, mode: { enum: ['fold', 'full'] },
    status: { enum: ['queued', 'running', 'done', 'failed'] }, error: { type: ['string', 'null'] }, image_url: { type: ['string', 'null'] },
  },
};
const render = {
  type: 'object',
  required: ['id', 'project_id', 'status', 'assignments'],
  properties: { id: uuid, project_id: uuid, mockup_id: { type: ['string', 'null'] }, status: { enum: ['queued', 'running', 'done', 'failed'] }, assignments: { type: 'object' }, urls: { type: 'object' } },
};
const mockup = {
  type: 'object',
  required: ['id', 'title', 'width', 'height', 'screens'],
  properties: { id: uuid, title: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, thumb_url: { type: 'string' }, screens: { type: 'array' } },
};
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const errors = { 401: { description: 'Missing or invalid API key', ...json(error) }, 429: { description: 'Rate limited', ...json(error) } };

export const SCHEMAS = { error, project, page, capture, render, mockup };

export const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Website Mockup Generator API', version: '1.0.0' },
  servers: [{ url: '/v1' }],
  components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'mk_...' } }, schemas: SCHEMAS },
  security: [{ apiKey: [] }],
  paths: {
    '/projects': {
      post: { summary: 'Create a project from a URL (starts page discovery)', requestBody: json({ type: 'object', required: ['url'], properties: { url: { type: 'string' } } }), responses: { 201: { description: 'Created', ...json({ type: 'object', required: ['project'], properties: { project, discoveryJobId: uuid } }) }, 422: { description: 'URL refused', ...json(error) }, ...errors } },
      get: { summary: 'List projects', responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['projects'], properties: { projects: { type: 'array', items: project } } }) }, ...errors } },
    },
    '/projects/{id}': { get: { summary: 'Get a project', responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['project'], properties: { project } }) }, 404: { description: 'Not found', ...json(error) }, ...errors } } },
    '/projects/{id}/pages': {
      get: { summary: 'Discovered pages', responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['pages'], properties: { pages: { type: 'array', items: page }, discovery: { type: 'object' } } }) }, ...errors } },
      patch: { summary: 'Select or unselect pages (max 20)', requestBody: json({ type: 'object', properties: { pageIds: { type: 'array', items: uuid }, selected: { type: 'boolean' } } }), responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['pages'], properties: { pages: { type: 'array', items: page } } }) }, ...errors } },
    },
    '/projects/{id}/captures': {
      post: { summary: 'Capture the selected pages', requestBody: json({ type: 'object', properties: { mode: { enum: ['fold', 'full'] }, devices: { type: 'array', items: { enum: ['desktop', 'tablet', 'mobile'] } } } }), responses: { 202: { description: 'Queued', ...json({ type: 'object', required: ['captures'], properties: { captures: { type: 'array', items: capture } } }) }, ...errors } },
      get: { summary: 'Capture status and images', responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['captures'], properties: { captures: { type: 'array', items: capture } } }) }, ...errors } },
    },
    '/projects/{id}/renders': { post: { summary: 'Render a mockup', requestBody: json({ type: 'object', required: ['mockupId'], properties: { mockupId: uuid, assignments: { type: 'object' }, preview: { type: 'boolean' }, formats: { type: 'array' } } }), responses: { 202: { description: 'Queued', ...json({ type: 'object', required: ['render'], properties: { render, jobId: uuid } }) }, ...errors } } },
    '/renders/{id}': { get: { summary: 'Render status and files', responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['render'], properties: { render } }) }, ...errors } } },
    '/projects/{id}/exports': { post: { summary: 'ZIP of the set', responses: { 202: { description: 'Queued', ...json({ type: 'object', required: ['jobId'], properties: { jobId: uuid, renderIds: { type: 'array' } } }) }, ...errors } } },
    '/mockups': { get: { summary: 'Published mockups', responses: { 200: { description: 'OK', ...json({ type: 'object', required: ['mockups'], properties: { mockups: { type: 'array', items: mockup } } }) }, ...errors } } },
  },
};
