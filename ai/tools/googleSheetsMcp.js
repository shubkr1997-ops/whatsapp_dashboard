// AI Google Sheets MCP Tool

const { google } = require('googleapis');

/**
 * Parses and returns a Google Auth Client from the JSON credentials
 */
function getAuthClient(credentialsJson) {
    try {
        const credentials = JSON.parse(credentialsJson);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        return auth;
    } catch (err) {
        console.error('[MCP Sheets] Auth Error:', err);
        throw new Error('Invalid Google Service Account JSON');
    }
}

/**
 * Extracts the spreadsheetId from a standard Google Sheets URL
 */
function extractSheetId(url) {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : url; // fallback assuming it might already be an ID
}

/**
 * The Read Tool schema to expose to LLMs
 */
const readGoogleSheetSchema = {
    name: 'read_google_sheet',
    description: 'Reads data from a specified range in a Google Sheet. Use this to lookup records, check inventory, find leads, or get contextual data from the linked spreadsheet.',
    parameters: {
        type: 'object',
        properties: {
            range: {
                type: 'string',
                description: 'The A1 notation of the range to read (e.g., "Sheet1!A1:D10" or just "Sheet1").'
            }
        },
        required: ['range']
    }
};

/**
 * The Write/Append Tool schema to expose to LLMs
 */
const writeGoogleSheetSchema = {
    name: 'write_google_sheet',
    description: 'Appends a new row of data to the bottom of a specified Google Sheet. Use this to save leads, log issues, or insert records.',
    parameters: {
        type: 'object',
        properties: {
            range: {
                type: 'string',
                description: 'The A1 notation of the range or sheet to append to (e.g., "Sheet1").'
            },
            values: {
                type: 'array',
                description: 'An array of strings representing the columns for the new row.',
                items: { type: 'string' }
            }
        },
        required: ['range', 'values']
    }
};

/**
 * Execute Read Tool
 */
async function executeReadSheet(mcpConfig, args) {
    const { sheet_url, credentials, allow_read } = mcpConfig;
    
    if (!allow_read) {
        return "Error: Read permission is denied for this Google Sheet MCP Server.";
    }

    try {
        const auth = getAuthClient(credentials);
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = extractSheetId(sheet_url);
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: args.range || 'Sheet1',
        });
        
        const rows = response.data.values;
        if (!rows || rows.length === 0) {
            return "The requested range is empty.";
        }
        
        // Convert to CSV-like format to return to the model efficiently
        return rows.map(row => row.join(', ')).join('\n');
    } catch (err) {
        return `Failed to read from Google Sheet: ${err.message}`;
    }
}

/**
 * Execute Write Tool
 */
async function executeWriteSheet(mcpConfig, args) {
    const { sheet_url, credentials, allow_write } = mcpConfig;

    if (!allow_write) {
        return "Error: Write permission is denied for this Google Sheet MCP Server.";
    }

    try {
        const auth = getAuthClient(credentials);
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = extractSheetId(sheet_url);
        
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: args.range || 'Sheet1',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [args.values]
            }
        });
        
        return `Successfully appended 1 row to the sheet at ${response.data.tableRange || args.range}.`;
    } catch (err) {
        return `Failed to write to Google Sheet: ${err.message}`;
    }
}

module.exports = {
    readGoogleSheetSchema,
    writeGoogleSheetSchema,
    executeReadSheet,
    executeWriteSheet
};
