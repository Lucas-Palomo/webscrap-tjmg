#!/usr/bin/env node
"use strict"

const {Command} = require("commander");
const program = new Command()

program
    .name("lawsuit")
    .version("0.0.1")
    .description("A web tracker to retrive all the movements in a lawsuit")
    .command(
        "retrieve [codes]",
        "Retrieve all the movements to the specified lawsuit",
        {executableFile: "./src/crawler.js", isDefault: true}
    )
    .alias("r")

program.parse(process.argv);