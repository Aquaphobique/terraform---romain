#!/bin/bash
set -euo pipefail 
INFO_COLOR="\033[36;1m"
WARNING_COLOR="\033[33;1m"
ERROR_COLOR="\033[31;1m"
RESET_COLOR="\033[0m"

display_msg()
{
    local msg=$1
    local type=$2

    if [ "$type" = "info" ]; then 
        echo -e "${INFO_COLOR}$msg${RESET_COLOR}"
    elif [ "$type" = "warning"  ]; then 
        echo -e "${WARNING_COLOR}$msg${RESET_COLOR}"
    elif [ "$type" = "error" ]; then 
        echo -e "${ERROR_COLOR}$msg${RESET_COLOR}"
    else 
        echo -e $msg
    fi

}

if [ ! -d ".git" ]; then 
    git init
    git add .
    git commit -m "feat/first-commit"
    git remote add origin git@github.com:$(git config user.name)/terraform-v1.git 
    git remote -v
else 
    display_msg "Already a git repo" info # $1="Already a git repo" $2=info
fi