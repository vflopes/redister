#!/bin/bash
npm install
docker build -f ./Dockerfile -t redister:dev .
docker build -f ./Dockerfile-stable -t redister:stable .