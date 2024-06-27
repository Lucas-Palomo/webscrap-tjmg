#!/usr/bin/env node
"use strict";

const axios = require('axios');
const jssoup = require('@aghajari/jssoup');
const {Command} = require('commander');
const FormData = require("form-data");
const fs = require("fs");

/**
 * --------------------------------------------------------------------------------
 *              THIS SECTION DEFINES THE CRAWLER'S MAIN VARIABLES
 * --------------------------------------------------------------------------------
 */
const baseUrl = "https://pje-consulta-publica.tjmg.jus.br";

let searchFormXpath = "*[@id=\"fPP\"]"

let searchResultTableXpath = "*[@id=\"fPP:processosTable\"]"
let searchResultLinkRegex = /'Consulta pública','(.*?)'/

let maxPaginationClass = "rich-inslider-right-num"
let movimentationsXpath = "*[@id=\"j_id134:processoEvento:tb\"]"

let sessionXpath = "*[@id=\"javax.faces.ViewState\"]"

let defaultHeaders = {
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Host': 'pje-consulta-publica.tjmg.jus.br',
    'sec-ch-ua': 'Not/A)Brand;v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'sec-ch-ua-Mobile': '?0',
    'sec-ch-ua-Platform': '"Linux"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-GPC': '1',
    // 'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}


/**
 * --------------------------------------------------------------------------------
 *              THIS SECTION DEFINES THE CRAWLER'S DYNAMIC VARIABLES
 * --------------------------------------------------------------------------------
 */

/**
 * @type {string[]}
 */
let cookies = []
let sessionId = null;
let save = false;
let outputDir = './save/'

/**
 * --------------------------------------------------------------------------------
 *                              END OF VARIABLES SECTION
 * --------------------------------------------------------------------------------
 */


const program = new Command();
program.option('-s, --save', 'Save each lawsuit in a txt file');
program.parse(process.argv);

const codes = program.args;


if (codes.length === 0) {
    console.error('Missing lawsuit code not found');
    process.exit(1);
}


if (program.opts().save) {
    console.log('\t -> Save enabled');
    save = true;
}


(async () => {
    for (const code of codes) {

        console.log(`\t -> Retrieving lawsuit information of: ${code}`);
        await scrap(code, save)
    }
})();

/**
 * @name scrap
 * @description Start the web scrap
 * @param {string} code
 * @param {boolean} save
 */
async function scrap(code, save) {
    let res = await search(code)

    if (res.status !== 200) {
        console.error('Failed to search');
        process.exit(1);
    }

    let links = findLawsuitLinkInSearchResult(res.data); // A logic to find many links in search result
    if (links.length > 0) {
        // In this test case, we're only looking for the first link
        let currentUrl = baseUrl + links[0]

        res = await openLawsuit(currentUrl)
        if (res.status !== 200) {
            console.error('Failed to open the lawsuit page');
            process.exit(1);
        }

        sessionId = extractSessionId(res.data)
        console.log(`\t -> Your session id is [${sessionId}]`);

        let maxPage = findMaxPagination(res.data)
        let nextPage = 2

        let movimentations = extractMovimentations(res.data)

        while (nextPage <= maxPage) {
            res = await simulatePaginationAjax(currentUrl, nextPage)
            if (res.status !== 200) {
                console.error('Failed to simulate pagination');
                process.exit(1);
            }

            res = await getSearchResultBasedOnPagination(currentUrl)
            if (res.status !== 200) {
                console.error('Failed to get search result based on pagination');
                process.exit(1);
            }

            movimentations = movimentations.concat(extractMovimentations(res.data));
            nextPage++;
        }

        if (save) {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir)
            }
            fs.rmSync(`${outputDir}/${code}.txt`, { force: true })
        }

        for (let movimentation of movimentations) {
            console.log(`\t\t -> ${movimentation}`)
            if (save) {
                fs.writeFileSync(`${outputDir}/${code}.txt`, movimentation + '\n', {flag: 'a'});
            }
        }
    }

}

/**
 * @name search
 * @param {string} code
 * @returns {Promise<{status: number, data: string, headers: axios.RawAxiosResponseHeaders}>}
 */
async function search(code) {
    let res = await getRequest(baseUrl)
    if (res.status !== 200) {
        console.error('Failed to start search');
        process.exit(1);
    }

    let searchLink = findSearchLink(res.data);
    if (cookies.length === 0) {
        cookies = res.headers['set-cookie'];
    }

    return postRequestForm(baseUrl + searchLink, createSearchForm(code))
}

/**
 * @name openLawsuit
 * @param {string} url
 * @returns {Promise<{status: number, data: string, headers: axios.RawAxiosResponseHeaders}>}
 */
async function openLawsuit(url) {
    return getRequest(url)
}


/**
 * @name simulatePaginationAjax
 * @description This method is a litle trick, to change the search results based on the current pagination
 * @param {string} url
 * @param {number} page
 * @returns {Promise<{status: number, data: string, headers: axios.RawAxiosResponseHeaders}>}
 */
async function simulatePaginationAjax(url, page) {
    return postRequestForm(url, createPaginationForm(page))
}

/**
 * @name getSearchResultBasedOnPagination
 * @description This method is a litle trick, to change the search results based on the current pagination
 * @param {string} url
 * @returns {Promise<{status: number, data: string, headers: axios.RawAxiosResponseHeaders}>}
 */
async function getSearchResultBasedOnPagination(url) {
    return postRequestForm(url, createPaginationForm())
}

/**
 * @name getRequest
 * @description Make a request and return the request info
 * @param {string} url
 * @returns {Promise<{status: number, data: string, headers: axios.RawAxiosResponseHeaders}>}
 */
async function getRequest(url) {
    const response = await axios.request({
        method: 'GET',
        url: url,
        headers: defaultHeaders
    });

    return {status: response.status, data: response.data, headers: response.headers}
}

/**
 * @name postRequestForm
 * @description Make a request and return the request info
 * @param {string} url
 * @param {FormData} form
 * @returns {Promise<{status: number, data: string, headers: axios.RawAxiosResponseHeaders}>}
 */
async function postRequestForm(url, form) {
    let postHeaders = defaultHeaders

    postHeaders["Cookie"] = cookies.map(cookie => cookie.split(';')[0]).join("; ")

    postHeaders = Object.assign(postHeaders, form.getHeaders());

    let response = await axios.request({
        method: 'POST',
        maxBodyLength: Infinity,
        url: url,
        headers: postHeaders,
        maxRedirects: 99,
        data: form
    })

    return {status: response.status, data: response.data, headers: response.headers}
}

/**
 * @name findSearchLink
 * @description Parse a raw html and find the search link
 * @param {string} html
 * @returns {string}
 */
function findSearchLink(html) {
    const soup = jssoup.load(html);
    /**
     * @type {HTMLNode|null}
     */
    let form = soup.findFirst(searchFormXpath);
    if (form !== null) {
        return form.attr.get("action")
    }

    console.error("Search link not found");
    process.exit(1);
}

/**
 * @name findLawsuitLink
 * @description Parse a raw html and find the lawsuit link
 * @param {string} html
 * @return {string[]}
 */
function findLawsuitLinkInSearchResult(html) {

    /**
     *
     * @type {string[]}
     */
    let links = []

    const soup = jssoup.load(html);
    let table = soup.findFirst(searchResultTableXpath)

    if (table !== null) {
        /**
         * @type HTMLNode[]
         */
        let rows = table.getElementsByTagName("tr")
        for (let row of rows) {
            /**
             * @type {HTMLNode|null}
             */
            let link = row.findFirst("a")
            if (link) {
                let searchResultLinkFragment = link.attr.get("onclick");
                let match = searchResultLinkFragment.match(searchResultLinkRegex);
                if (match) {
                    links.push(match[1]);
                }
            }
        }
    }

    return links
}

/**

 /**
 * @name findMaxPagination
 * @description Parse a raw html and find the lawsuit link
 * @param {string} html
 * @return {number}
 */
function findMaxPagination(html) {

    /**
     *
     * @type {string[]}
     */
    let links = []

    const soup = jssoup.load(html);
    let page = soup.getElementByClassName(maxPaginationClass)

    if (page) {
        return Number(page.innerText())
    }

    console.log("Cannot find max pagination element")
    process.exit(1)
}

/**
 * @name extractMovimentations
 * @description Parse a raw html and extract the movimentations
 * @param {string} html
 * @return {string[]}
 */
function extractMovimentations(html) {

    /**
     *
     * @type {string[]}
     */
    let movimentations = []

    const soup = jssoup.load(html);
    let element = soup.findFirst(movimentationsXpath)

    if (element) {
        for (let span of element.getElementsByTagName("span")) {
            if (span.getAttribute("id")) {
                movimentations.push(span.innerText());
            }
        }
    }

    return movimentations
}


/**
 * @name extractSessionId
 * @description Parse a raw html and extract the movimentations
 * @param {string} html
 * @return {string}
 */
function extractSessionId(html) {


    const soup = jssoup.load(html);
    let element = soup.findFirst(sessionXpath)

    if (element) {
        return element.getAttribute("value")
    }

    console.error("Session Id not found")
    process.exit(1)
}


/**
 * @name createSearchForm
 * @description Create the Search Payload
 * @param {string} code
 * @return {FormData}
 */
function createSearchForm(code) {
    let data = new FormData();
    data.append('fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso', code);
    data.append('mascaraProcessoReferenciaRadio', 'on');
    data.append('fPP:j_id150:processoReferenciaInput', '');
    data.append('fPP:dnp:nomeParte', '');
    data.append('fPP:j_id168:nomeSocial', '');
    data.append('fPP:j_id177:alcunha', '');
    data.append('fPP:j_id186:nomeAdv', '');
    data.append('fPP:j_id195:classeProcessualProcessoHidden', '');
    data.append('tipoMascaraDocumento', 'on');
    data.append('fPP:dpDec:documentoParte', '');
    data.append('fPP:Decoration:numeroOAB', '');
    data.append('fPP:Decoration:j_id230', '');
    data.append('fPP:Decoration:estadoComboOAB:org.jboss.seam.ui.NoSelectionConverter.noSelectionValue', '');
    data.append('fPP', 'fPP');
    data.append('autoScroll', '');
    data.append('javax.faces.ViewState', 'j_id1');
    data.append('fPP:j_id236', 'fPP:j_id236');
    data.append('AJAXREQUEST', '_viewRoot');
    data.append('AJAX:EVENTS_COUNT', '1');
    return data
}

/**
 * @param {number?} page
 * @returns {FormData}
 */
function createPaginationForm(page) {
    let data = new FormData();

    data.append('javax.faces.ViewState', sessionId);

    if (page) { // Case page is not null, then use ajax request
        data.append("AJAXREQUEST", "j_id134:j_id458");
        data.append("AJAX:EVENTS_COUNT", "1")
        data.append('j_id134:j_id531:j_id532', page);
        data.append('j_id134:j_id531', 'j_id134:j_id531');
        data.append('autoScroll', '');
        data.append('j_id134:j_id531:j_id533', 'j_id134:j_id531:j_id533');
    }


    return data
}