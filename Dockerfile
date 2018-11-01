FROM redis:5

RUN groupadd --gid 1000 node \
	&& useradd --uid 1000 --gid node --shell /bin/bash --create-home node \
	&& apt-get -y update \
	&& apt-get -y install curl gnupg \
	&& curl -sL https://deb.nodesource.com/setup_8.x | bash -
RUN apt-get install -y nodejs

CMD [ "node" ]