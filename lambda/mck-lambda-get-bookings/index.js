const { Client } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// ระบุ Region ให้ตรงกับที่ใช้งาน (จากรูปก่อนหน้าคือ ap-southeast-1)
const secretsClient = new SecretsManagerClient({ region: 'ap-southeast-1' });

let dbConfig = null;

// ฟังก์ชันสำหรับดึง Secret
async function getDbConfig() {
    if (dbConfig) return dbConfig; // Cache ไว้ จะได้ไม่ต้องดึงใหม่ทุกรอบที่ Container ยังรันอยู่
    
    // ตั้งชื่อ Secret Name ใน Environment Variables
    const secretName = process.env.SECRET_NAME; 
    
    try {
        const response = await secretsClient.send(
            new GetSecretValueCommand({ SecretId: secretName })
        );
        dbConfig = JSON.parse(response.SecretString);
        return dbConfig;
    } catch (error) {
        console.error("Error retrieving secret:", error);
        throw error;
    }
}

exports.handler = async (event) => {
    // 1. ดึง Credentials จาก Secrets Manager
    let credentials;
    try {
        credentials = await getDbConfig();
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to retrieve database credentials' }) };
    }

    // 2. ตั้งค่าการเชื่อมต่อ PostgreSQL โดยใช้คีย์มาตรฐานของ RDS Secret
    const client = new Client({
        host: credentials.host,
        user: credentials.username,
        password: credentials.password,
        database: credentials.dbname,
        port: credentials.port || 5432,
    });

    await client.connect();

    const httpMethod = event.httpMethod;
    const path = event.resource || event.path;

    try {
        // ---------------------------------------------------------
        // เส้นทางที่ 1: GET /admin/bookings/pending
        // ---------------------------------------------------------
        if (httpMethod === 'GET' && path === '/admin/bookings/pending') {
            const res = await client.query(`
                SELECT id, child_name, age, course_id, booking_time 
                FROM bookings 
                WHERE status = 'pending' 
                ORDER BY booking_time ASC
            `);
            
            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ pending_bookings: res.rows }),
            };
        }

        // ---------------------------------------------------------
        // เส้นทางที่ 2: PUT /admin/bookings/{id}/approve
        // ---------------------------------------------------------
        if (httpMethod === 'PUT' && path.includes('/approve')) {
            const bookingId = event.pathParameters.id;
            const body = JSON.parse(event.body || '{}');
            const staffId = body.assigned_staff_id;

            if (!staffId) {
                return { 
                    statusCode: 400, 
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({ message: 'กรุณาส่ง assigned_staff_id มาด้วย' }) 
                };
            }

            const res = await client.query(`
                UPDATE bookings 
                SET status = 'confirmed', assigned_staff_id = $1 
                WHERE id = $2 AND status = 'pending'
                RETURNING id
            `, [staffId, bookingId]);

            if (res.rowCount === 0) {
                return { 
                    statusCode: 404, 
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({ message: 'ไม่พบข้อมูลการจอง หรือคิวนี้ถูกอนุมัติไปแล้ว' }) 
                };
            }

            return {
                statusCode: 200,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ message: 'อนุมัติคิวสำเร็จ' }),
            };
        }

        return { statusCode: 404, body: 'Route Not Found' };

    } catch (error) {
        console.error('Database Error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message }),
        };
    } finally {
        await client.end();
    }
};