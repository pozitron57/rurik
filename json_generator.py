#! /usr/bin/env python 
#coding=utf8
'''Routine to create *.json file from data file source.data (containing just tabbed names)'''
import os,shutil,glob,sys,string,re
import fileinput

### Note you need python 3
### and last guy in your file will be invisible, but he should be indented like one before him
### and first one too

### REPLACE PATHES TO YOURS
source_file = '/home/slisakov/Documents/sites/gittree/source.data'
output_file = '/home/slisakov/Documents/sites/gittree/py_generated.json'
### what is your tabstop value (number of spaces)?
tabstop = 4

### declare list with names
rebyata=[]
### declare list with offset values
shift_list=[]
with open(source_file, 'r') as f:
    for line in f:
        if not re.search(r'#', line) and not line in ['\n', '\r\n']: # ignore hash comments and empty lines (whole line with hash in ANY place would be considered as commented.)
            line = line.rstrip('\n')    #cut out newline sign at the end of the lines
            shift = len(line) - len(line.lstrip())  #count how much leading spaces there are
            shift_list.append(shift)    #add shift value to list with shift values
            imya = line.strip()         #cut out leading spaces and set name of a guy = imya
            rebyata.append(imya)        #add name of a guy to the list with names
lastlineshift = shift                   #put shift value at the last line into memory. We will need it later
print(lastlineshift)                    #just to see smth.

### In my example I need to have two root nodes. I achieve it by making first real root invisible, the same color as background (white)
json_defaults_for_root = '{ "name": "",  "radius": 1, "granica": "white", "liniya": "white", "zapolnenie": "white", "zapolnenie_collapsed": "white", "text_color": "white", "children": ['
json_defaults =  '", "radius": 6, "granica": "#bc5729", "liniya": "#ccc", "zapolnenie": "white", "zapolnenie_collapsed": "lightsteelblue", "text_color": "black" ' 
json_invisible =  '{ "name": "", "radius": 0, "granica": "white", "liniya": "white", "zapolnenie": "white", "zapolnenie_collapsed": "white", "text_color": "white" }'

### open file for writing
with open (output_file, 'w+') as f1:
    for i in range(  len(rebyata) - 1 ):
        ###for the very first line print (make this first guy invisible):
        if i == 0:
            print (json_defaults_for_root, file=f1)
        else:
            if shift_list[i+1] == shift_list[i]:  # if next guy shifted as current he considered as a brother, then write folliwing line to file
                print( shift_list[i]*' ' + '{ "name": "' + rebyata[i] + json_defaults + '},', file=f1 ) 
            if shift_list[i+1] - shift_list[i] == tabstop :  # if next guy shifted right, consider him as a son of a current guy
                print( shift_list[i]*' ' + '{ "name": "' + rebyata[i] + json_defaults + ', "children": [', file=f1 )
            for j in range (1,22):
                if shift_list[i+1] - shift_list[i] == -tabstop*j:   # if next guy shifted to the left for 1,2,3,4... tabstops, add corresponding amount of ] and }.
                    print(shift_list[i]*' ' + '{ "name": "' + rebyata[i]  + json_defaults + '}' +  j * ' ] }' + ',', file=f1)

### open created file and delete last comma
with open (output_file, 'rb+') as f2:
    f2.seek(-2, os.SEEK_END)
    f2.truncate()

### open created file and add necessary amount of ]} brackets. Note that the mode is 'a+' which means append to a file
with open (output_file, 'a+') as f3:
    print ( ' ' + int(lastlineshift/tabstop )* ']}', file=f3)


### set all colors for persons called "invisible" to white.
for line in fileinput.input(output_file, inplace=True):
    if re.search(r'invisible', line):
        print (re.sub(r'{.*}', json_invisible, line), end="")
    else:
        print(line, end="")
        #print(line.replace('{.*}', 'white'), end='') # а как заменить black на white и gray на white???

### make lines to following guys invisible:
for line in fileinput.input(output_file, inplace=True):
    if re.search(r'"Рюрик"', line) or re.search(r'Вещий Олег', line) or re.search(r'Ольга', line):
        print (re.sub(r'"liniya": "[^"]*"', '"liniya": "white"', line), end="")
    else: 
        print(line, end="")

### make Rurik bigger
for line in fileinput.input(output_file, inplace=True):
    if re.search(r'"Рюрик"', line):
        print (re.sub(r'"radius": \d', '"radius": 7', line), end="")
    else: 
        print(line, end="")

### paint lines to IVAN THE TERRIBLE ancestors purple
for line in fileinput.input(output_file, inplace=True):
    if re.search(r'"Игорь"', line) or re.search(r'Святослав Игоревич', line) or re.search(r'Владимир Красное Солнышко', line)  or re.search(r'Ярослав Мудрый', line) or re.search(r'"Всеволод Ярославич"', line) or re.search(r'Мономах', line) or re.search(r'Долгорукий', line) or re.search(r'Гнездо', line) or re.search(r'Ярослав Владимирский', line) or re.search(r'Александр Невский', line) or re.search(r'св. Даниил, Москва', line) or re.search(r'Калита', line) or re.search(r'Иван II Красный', line) or re.search(r'Дмитрий Донской', line) or re.search(r'Василий I Дмитриевич', line) or re.search(r'Василий II Тёмный', line) or re.search(r'Иван III Великий', line) or re.search(r'Василий III', line) or re.search(r'Грозный', line):
        print (re.sub(r'"liniya": "[^"]*"', '"liniya": "purple"', line), end="")
    else: 
        print(line, end="")


ivan = vasiliy = vasilko = vsevolod = vsevolodko = rogvolod = svyatoslav = rostislav = bryachislav = vyacheslav = vladimir = yaroslav = rurik = 0
### count name occurences and print it. Just for info
for line in fileinput.input(output_file, inplace=True):
    if re.search(r'"Иван ', line):
        print(line, end="")
        ivan+=1
    elif re.search(r'"Василий ', line):
        print(line, end="")
        vasiliy+=1
    elif re.search(r'"Василько ', line):
        print(line, end="")
        vasilko+=1
    elif re.search(r'"Владимир ', line):
        print(line, end="")
        vladimir+=1
    elif re.search(r'"Святослав ', line):
        print(line, end="")
        svyatoslav+=1
    elif re.search(r'"Ростислав ', line):
        print(line, end="")
        rostislav+=1
    elif re.search(r'"Всеволод ', line):
        print(line, end="")
        vsevolod+=1
    elif re.search(r'"Брячислав ', line):
        print(line, end="")
        bryachislav+=1
    elif re.search(r'"Ярослав ', line):
        print(line, end="")
        yaroslav+=1
    elif re.search(r'"Рюрик', line):
        print(line, end="")
        rurik+=1
    else:
        print (line, end="")


print('ivan = ', ivan)
print('vasiliy = ', vasiliy)
print('vasilko = ', vasilko)
print('svyatoslav = ', svyatoslav)
print('rostislav = ', rostislav)
print('vladimir = ', vladimir)
print('vsevolod = ', vsevolod)
print('bryachislav = ', bryachislav)
print('yaroslav = ', yaroslav)
print('rurik = ', rurik)

