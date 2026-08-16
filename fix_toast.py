import codecs

with codecs.open('custom.js', 'r', 'utf-8') as f:
    content = f.read()

content = content.replace('showToast(품목명이 [] (으)로 변경되었습니다., \"success\");', 'showToast(품목명이 [] (으)로 변경되었습니다., \"success\");')

with codecs.open('custom.js', 'w', 'utf-8') as f:
    f.write(content)
