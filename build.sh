#!/bin/bash
npm install
docker build --network=host -f ./Dockerfile -t redister:dev .
docker build --network=host -f ./Dockerfile-stable -t redister:stable .