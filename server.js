require('dotenv').config();
const http = require('http');
const mysql = require('mysql2/promise');
const bcrypt = require("bcrypt");
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const SALT_ROUNDS = 10;
const verificationEmailTemplate = fs.readFileSync(path.join(__dirname, 'email.html'), 'utf8');
const topFirstTemplate = fs.readFileSync(path.join(__dirname, 'email_first.html'), 'utf8');
const topSecondTemplate = fs.readFileSync(path.join(__dirname, 'email_second.html'), 'utf8');
const topThirdTemplate = fs.readFileSync(path.join(__dirname, 'email_third.html'), 'utf8');
const topTenTemplate = fs.readFileSync(path.join(__dirname, 'email_top_ten.html'), 'utf8');
let music_file;

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function sendVerificationEmail(email, user_token) {
    const oAuth2Client = new google.auth.OAuth2(
        process.env.OAUTH_ID,
        process.env.OAUTH_SECRET,
        'https://developers.google.com/oauthplayground'
    );

    oAuth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH });
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const verificationUrl = `https://gornikopendaynodeapi.onrender.com/email/verify?token=${user_token}`;
    const finalHtml = verificationEmailTemplate.replace(/{{verification_link}}/g, verificationUrl);

    const encodeWord = (word) => `=?utf-8?B?${Buffer.from(word).toString('base64')}?=`;

    const displayName = encodeWord("Zespół Górnik TBG");
    const subject = encodeWord("Weryfikacja konta - GórnikOpen");

    const messageParts = [
        `From: ${displayName} <${process.env.GMAIL_LOGIN}>`,
        `To: ${email}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        finalHtml,
    ];

    const message = messageParts.join('\n');

    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log('Message sent! ID:', res.data.id);
    } catch (error) {
        console.error('API Error:', error.response ? error.response.data : error);
    }
}

async function sendWinnerEmail(email, position) {
    const oAuth2Client = new google.auth.OAuth2(
        process.env.OAUTH_ID,
        process.env.OAUTH_SECRET,
        'https://developers.google.com/oauthplayground'
    );

    oAuth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH });
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const encodeWord = (word) => `=?utf-8?B?${Buffer.from(word).toString('base64')}?=`;

    const displayName = encodeWord("Zespół Górnik TBG");
    const subject = encodeWord("Wyniki GórnikOpen");

    const messageParts = [
        `From: ${displayName} <${process.env.GMAIL_LOGIN}>`,
        `To: ${email}`,
        'Content-Type: text/html; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        (position == 1 ? topFirstTemplate : position == 2 ? topSecondTemplate : position == 3 ? topThirdTemplate : topTenTemplate),
    ];


    const message = messageParts.join('\n');

    const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {
        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });
        console.log('Message sent! ID:', res.data.id);
    } catch (error) {
        console.error('API Error:', error.response ? error.response.data : error);
    }
}

const server = http.createServer(async (req, res) => {
    console.log("Got a request");
    let body = ""
    if (req.method === "POST") {
        switch (req.url) {
            case "/user/add":
                let connection;
                body = "";
                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection()
                        if (!data.email || !data.password) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Brak adresu email lub hasła" }));
                        }

                        const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
                        const buffer = crypto.randomBytes(32);
                        const token = buffer.toString('hex');
                        await connection.execute(
                            'DELETE FROM users WHERE verified = false AND email = ?',
                            [data.email]
                        )
                        await connection.execute(
                            `INSERT INTO users(email, password, points, verification_token)
                             VALUES (?, ?, ?, ?)`,
                            [data.email, hashedPassword, 0, token]
                        );
                        console.log("Email: " + data.email)
                        await sendVerificationEmail(data.email, token)

                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ message: "Sprawdź pocztę email" }));

                    } catch (err) {
                        console.error(err);

                        if (err.code === "ER_DUP_ENTRY") {
                            res.writeHead(409, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Użytkownik już istnieje" }));
                        }

                        if (err.code === "ER_BAD_NULL_ERROR") {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Brak wymaganych danych" }));
                        }

                        if (err instanceof SyntaxError) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Niepoprawny JSON" }));
                        }

                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: "Błąd serwera" }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/getByEmailAndPassword":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);

                        if (!data.email || !data.password) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Brak nazwy użytkownika lub hasła" }));
                        }

                        connection = await pool.getConnection();

                        const [rows] = await connection.execute(
                            `SELECT password
                             FROM users
                             WHERE email = ?
                               AND verified = true`,
                            [data.email]
                        );

                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");
                            ;
                        } else {
                            const hashedPassword = rows[0].password;
                            if (await bcrypt.compare(data.password, hashedPassword)) {
                                const [rows] = await connection.execute(
                                    `SELECT id, email, points, creation_date as creationDate
                                     FROM users
                                     WHERE email = ?`,
                                    [data.email]
                                );
                                console.log(rows[0])
                                res.writeHead(201, { 'Content-Type': 'application/json' });
                                const user = rows[0];
                                console.log(JSON.stringify(user))
                                res.end(JSON.stringify(user));
                            } else {
                                throw new Error("Nieprawidłowe dane logowania");
                                ;
                            }

                        }


                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/delete":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);

                        if (!data.email) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            return res.end(JSON.stringify({ error: "Użytkownik nie istnieje" }));
                        }
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT id
                             FROM users
                             WHERE email = ?`,
                            [data.email]
                        );

                        if (rows.length === 0) {
                            throw new Error("Użytkownik nie istnieje");
                            ;
                        } else {
                            const selectedUser = rows[0];
                            const val1 = await connection.execute(
                                'DELETE FROM user_questions_answered WHERE user_id = ?',
                                [selectedUser.id]
                            )
                            const val2 = await connection.execute(
                                'DELETE FROM users WHERE id = ?',
                                [selectedUser.id]
                            )
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ message: "Konto zostało usunięte" }));

                        }


                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/changePassword":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);

                        if (!data.email || !data.oldPassword || !data.newPassword) {
                            throw new Error("Brak nazwy użytkownika, hasła lub nowego hasła");
                        }
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT password, id
                             FROM users
                             WHERE email = ?`,
                            [data.email]
                        );

                        if (rows.length === 0) {
                            throw new Error("Nieprawidłowe dane logowania");
                            ;
                        } else {
                            const hashedPassword = rows[0].password;
                            if (await bcrypt.compare(data.oldPassword, hashedPassword)) {
                                const new_password = await bcrypt.hash(data.newPassword, SALT_ROUNDS);
                                const [] = await connection.execute(
                                    'UPDATE users SET password = ? WHERE id = ?',
                                    [new_password, rows[0].id]
                                )
                                res.writeHead(201, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ message: "Poprawnie zmieniono hasło" }));
                            } else {
                                throw new Error("Nieprawidłowe dane logowania");
                            }

                        }

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/score/getTopTenUsers":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT CONCAT(SUBSTR(u.email,1,3),'...@poczta.pl') as "email", u.points, total_time_spent as 'timeSpentTotal' FROM users u WHERE u.verified = true
ORDER BY u.points DESC, total_time_spent  ASC, u.email ASC LIMIT 10`
                        );
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(rows));

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/score/getTopTenUsersForSubject":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT CONCAT(SUBSTR(u.email,1,3),'...@poczta.pl') as "email", sum(q.points_awarded ) as "points" , sum(uqa.time_spent) as 'timeSpentTotal' FROM users u
INNER JOIN user_questions_answered uqa ON uqa.user_id = u.id 
INNER JOIN questions q ON q.id = uqa.question_id 
GROUP BY u.email, uqa.correct, q.subject, u.verified  
HAVING q.subject = 'geografia' AND uqa.correct = true AND u.verified = true
ORDER BY points DESC, timeSpentTotal  ASC, u.email ASC LIMIT 10`,
                            [data.subject]
                        );
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(rows));

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/getPosition":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT u.email, u.points, total_time_spent FROM users u
WHERE u.email=?
ORDER BY u.points DESC, total_time_spent  ASC, u.email ASC `,
                            [data.email]
                        );
                        if (rows.length === 0) {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ message: "0" }));
                        } else {
                            const [val] = await connection.execute(
                                `select count(*) + 1 as "message" from (SELECT u.email, u.points, total_time_spent FROM users u
WHERE (points > ? OR (points = ? AND total_time_spent < ?)) AND email <> ? AND u.verified =true
ORDER BY u.points DESC, total_time_spent ASC, u.email ASC) as "Merged Table"`,
                                [rows[0].points, rows[0].points, rows[0].total_time_spent, data.email]
                            );
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            if (val.length === 0) {
                                res.end(JSON.stringify({ message: "0" }));
                            } else {
                                res.end(JSON.stringify(val[0]));
                            }
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/getPositionForSubject":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT u.email, sum(q.points_awarded) as "points", sum(uqa.time_spent) as "total_time_spent" FROM users u
INNER JOIN user_questions_answered uqa ON uqa.user_id = u.id 
INNER JOIN questions q ON q.id = uqa.question_id 
GROUP BY u.email, u.points, uqa.correct, q.subject, u.verified
HAVING u.email=? AND q.subject = ? AND uqa.correct = true AND u.verified = true
ORDER BY u.points DESC, total_time_spent  ASC, u.email ASC `,
                            [data.email, data.subject]
                        );
                        if (rows.length === 0) {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ message: "0" }));
                        } else {
                            const [val] = await connection.execute(
                                `select count(*) + 1 as "message" from (
SELECT  u.email, sum(q.points_awarded ), sum(uqa.time_spent) FROM users u
INNER JOIN user_questions_answered uqa ON uqa.user_id = u.id 
INNER JOIN questions q ON q.id = uqa.question_id
GROUP BY u.email, u.points, uqa.correct, q.subject, u.verified
HAVING (sum(q.points_awarded ) > ? OR (sum(q.points_awarded ) = ? AND sum(uqa.time_spent) < ?)) AND email <> ? AND q.subject = ? AND uqa.correct = true AND u.verified = true
ORDER BY u.points DESC, total_time_spent  ASC, u.email ASC 
) as "Merged Table"`,
                                [rows[0].points, rows[0].points, rows[0].total_time_spent, data.email, data.subject]
                            );
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            if (val.length === 0) {
                                res.end(JSON.stringify({ message: "0" }));
                            } else {
                                res.end(JSON.stringify(val[0]));
                            }
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/getPoints":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `select points as "message" from gornikOpenDay.users where email = ?`,
                            [data.email]
                        );
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        if (rows.length === 0) {
                            res.end(JSON.stringify({ message: "0" }));
                        } else {
                            res.end(JSON.stringify(rows[0]));
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/getTotalTime":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;
                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `SELECT total_time_spent as "message" FROM users u
WHERE u.email=?`,
                            [data.email]
                        );
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        if (rows.length === 0) {
                            res.end(JSON.stringify({ message: "0" }));
                        } else {
                            res.end(JSON.stringify(rows[0]));
                        }
                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });
                break;
            case "/user/setQuestionAsAnswered":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            'select id from users where email = ?',
                            [data.email])
                        const [rows1] = await connection.execute(
                            'select points_awarded from questions where id = ?',
                            [data.questionId])

                        const [] = await connection.execute(
                            'insert into user_questions_answered(user_id, question_id,correct,time_spent) values(?,?,?,?)',
                            [rows[0].id, data.questionId, data.correct, data.timeSpent])

                        if (data.correct) {
                            const [] = await connection.execute(
                                'update users set points = points + ?, total_time_spent = total_time_spent + ? where id = ?',
                                [rows1[0].points_awarded, data.timeSpent, rows[0].id])
                        }
                        if (rows.length === 0) {
                            throw new Error("Użytkownik nie istnieje")
                        } else {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ message: "Poprawnie odpowiedziano" }));
                        }

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/user/getUnansweredQuestionsForSubject":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows1] = (await connection.execute(
                            'select id from users where email = ?',
                            [data.email])
                        )
                        const [rows] = await connection.execute(
                            `select q.id, q.subject, q.content, q.answers, q.points_awarded as pointsAward, q.music_uri as "musicUri", q.image_uri as "imageUri" from (
select id from (
select q.id from questions as q
union all
select  q.id
from questions q left join user_questions_answered uqa on uqa.question_id  = q.id
inner join users u on u.id = uqa.user_id  where uqa.user_id = ?
)
as mt group by mt.id having count(mt.id) = 1
) as qid 
inner join questions q on q.id = qid.id where q.subject = ?`,
                            [rows1[0].id, data.subject]
                        );
                        if (rows.length === 0) {
                            throw new Error("Użytkownik odpowiedział na wszystkie pytania")
                        } else {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(rows));
                        }

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
            case "/questions/getAllForSubject":
                body = "";

                req.on("data", chunk => {
                    body += chunk.toString();
                });

                req.on("end", async () => {
                    let connection;

                    try {
                        const data = JSON.parse(body);
                        connection = await pool.getConnection();
                        const [rows] = await connection.execute(
                            `select q.id, q.subject, q.content, q.answers, q.points_awarded as pointsAward, q.music_uri as "musicUri", q.image_uri as "imageUri" from questions q where q.subject = ?`,
                            [data.subject]
                        );
                        if (rows.length === 0) {
                            throw new Error("Nie ma pytań na ten temat")
                        } else {
                            res.writeHead(201, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(rows));
                        }

                    } catch (err) {
                        console.error(err)
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    } finally {
                        if (connection) connection.release();
                    }
                });

                break;
        }
    } else if (req.method === "GET") {
        const fullUrl = new URL(req.url, `http://${req.headers.host}`);
        switch (fullUrl.pathname) {
            case "/email/verify":
                let connection;
                try {
                    const token = fullUrl.searchParams.get('token');

                    if (!token) {
                        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                        return res.end('Błąd: Brak tokenu.');
                    }
                    connection = await pool.getConnection();
                    const [rows] = await connection.execute('select id from users WHERE verified = false AND verification_token = ? AND token_created_at > NOW() - INTERVAL 1 DAY',
                        [token])
                    const isTokenValid = !(rows.length === 0);

                    if (isTokenValid) {
                        const [] = await connection.execute('update users set verified = true, verification_token = null, token_created_at = null where id = ?',
                            [rows[0].id])
                        const successPage = path.join(__dirname, 'verified.html');
                        fs.readFile(successPage, (err, content) => {
                            if (err) {
                                res.writeHead(500);
                                res.end('Error loading page');
                            } else {
                                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                                res.end(content);
                            }

                        });
                    } else {
                        res.writeHead(400);
                        res.end('Nieprawidłowy token.');
                    }
                } catch (err) {
                } finally {
                    if (connection) connection.release()
                }

                break;
            case "/music/furelise.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/furelise.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/drums.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/drums.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/wonderful_world.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/wonderful_world.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/smooth_criminal.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/smooth_criminal.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/caprice_24.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/caprice_24.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/oczy_zielone.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/oczy_zielone.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/bohemian_rhapsody.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/bohemian_rhapsody.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/stairway_to_heaven.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/stairway_to_heaven.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/imperial_march.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/imperial_march.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;
            case "/music/grand_march.mp3":
                music_file = fs.readFileSync(path.join(__dirname, "music/grand_march.mp3"))
                try {
                    res.writeHead(200, { 'Content-Type': "audio/mpeg" });
                    res.end(music_file);
                } catch (err) { }
                break;

        }
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Nie znaleziono endpointu" }));
    }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});