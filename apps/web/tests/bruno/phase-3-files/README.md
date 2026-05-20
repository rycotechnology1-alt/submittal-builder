# Phase 3 Bruno Flow

Run Phase 2 requests `01 Create Project` and `02 Create Package` first, then set:

- `packageId=<id returned by 02 Create Package>`
- `sourcePdfId=<id returned by Source PDF Presign>`
- `sourcePageId=<id from GET /packages/:id/status after confirm, or from DB while no list endpoint exists>`

Flow:

1. `POST {{baseUrl}}/api/v1/packages/{{packageId}}/source-pdfs/presign`
   Body: `{ "filename": "sample.pdf", "byte_size": 12345, "content_type": "application/pdf" }`
2. Browser/client `PUT` to `upload_url` with every returned `required_headers` entry.
3. `POST {{baseUrl}}/api/v1/packages/{{packageId}}/source-pdfs/{{sourcePdfId}}/confirm`
   Body: `{}`
4. `GET {{baseUrl}}/api/v1/packages/{{packageId}}/status`
5. `GET {{baseUrl}}/api/v1/source-pages/{{sourcePageId}}/preview`
6. `GET {{baseUrl}}/api/v1/source-pdfs/{{sourcePdfId}}/download`

Workspace logo flow:

1. `POST {{baseUrl}}/api/v1/workspace/logo/presign`
2. Browser/client `PUT` to `upload_url`.
3. `POST {{baseUrl}}/api/v1/workspace/logo/confirm`
4. `GET {{baseUrl}}/api/v1/workspace`
