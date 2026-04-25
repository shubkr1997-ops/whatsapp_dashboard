// AI WhatsApp MCP Tools (Catalogs & Flows)

const db = require('../../data/db');
const whatsappService = require('../../src/services/whatsapp.service');

/**
 * The Send Catalog Tool schema to expose to LLMs
 */
const sendCatalogSchema = {
    name: 'send_whatsapp_catalog',
    description: 'Sends a product catalog or a specific product from a catalog to the customer. Use this when the customer asks to see products, a menu, or specific item details.',
    parameters: {
        type: 'object',
        properties: {
            catalog_id: {
                type: 'string',
                description: 'The ID of the catalog to send (optional if product_id is provided).'
            },
            product_id: {
                type: 'string',
                description: 'The specific product ID to send (optional).'
            },
            body_text: {
                type: 'string',
                description: 'Optional introductory text to send with the catalog.'
            }
        }
    }
};

/**
 * The Send Flow Tool schema to expose to LLMs
 */
const sendFlowSchema = {
    name: 'send_whatsapp_flow',
    description: 'Sends an interactive WhatsApp Flow (form/survey/process) to the customer. Use this for lead generation, feedback, registrations, or multi-step data collection.',
    parameters: {
        type: 'object',
        properties: {
            flow_id: {
                type: 'string',
                description: 'The ID of the flow to send.'
            },
            flow_cta: {
                type: 'string',
                description: 'The text for the button that opens the flow (e.g., "Start Survey").'
            },
            body_text: {
                type: 'string',
                description: 'Optional introductory text to send with the flow.'
            }
        },
        required: ['flow_id']
    }
};

/**
 * Execute Send Catalog Tool
 */
async function executeSendCatalog(mcpConfig, args, contactPhone) {
    const { allow_send } = mcpConfig;
    
    if (!allow_send) {
        return "Error: Send permission is denied for this WhatsApp Catalog MCP Server.";
    }

    try {
        const catalogId = args.catalog_id || mcpConfig.catalog_id;
        const productId = args.product_id;
        const bodyText = args.body_text || "Check out our products!";

        if (productId) {
             // In a real implementation, we'd call the Meta API to send a single product
             // For now, we'll simulate it via our service
             await whatsappService.sendViaWhatsApp(contactPhone, `[Sent Product: ${productId} from Catalog ${catalogId}] ${bodyText}`);
             return `Successfully sent product ${productId} to the customer.`;
        } else {
             await whatsappService.sendViaWhatsApp(contactPhone, `[Sent Catalog: ${catalogId}] ${bodyText}`);
             return `Successfully sent catalog ${catalogId} to the customer.`;
        }
    } catch (err) {
        return `Failed to send catalog: ${err.message}`;
    }
}

/**
 * Execute Send Flow Tool
 */
async function executeSendFlow(mcpConfig, args, contactPhone) {
    const { allow_send } = mcpConfig;

    if (!allow_send) {
        return "Error: Send permission is denied for this WhatsApp Flow MCP Server.";
    }

    try {
        const flowId = args.flow_id || mcpConfig.flow_id;
        const flowCTA = args.flow_cta || "Get Started";
        const bodyText = args.body_text || "Please fill out this form.";

        // We use the whatsappService to send the flow
        // In this dashboard app, we'd ideally have a real implementation
        // But for simulation, it will log the action.
        await whatsappService.sendViaWhatsApp(contactPhone, `[Sent Flow: ${flowId}] ${bodyText}`, {
            flow_id: flowId,
            flow_cta: flowCTA
        });
        
        return `Successfully sent flow ${flowId} to the customer.`;
    } catch (err) {
        return `Failed to send flow: ${err.message}`;
    }
}

module.exports = {
    sendCatalogSchema,
    sendFlowSchema,
    executeSendCatalog,
    executeSendFlow
};
